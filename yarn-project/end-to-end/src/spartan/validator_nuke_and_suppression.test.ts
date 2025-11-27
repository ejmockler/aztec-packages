import { EthAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { RollupCheatCodes } from '@aztec/aztec/testing';
import { RollupContract, type ViemPublicClient } from '@aztec/ethereum';
import { ChainMonitor, EthCheatCodesWithState } from '@aztec/ethereum/test';
import { createLogger } from '@aztec/foundation/log';
import { promiseWithResolvers } from '@aztec/foundation/promise';
import { retryUntil } from '@aztec/foundation/retry';
import { sleep } from '@aztec/foundation/sleep';
import { DateProvider } from '@aztec/foundation/timer';
import { type SlasherConfig, type TallySlasherSettings, getTallySlasherSettings } from '@aztec/slasher';
import { type L1RollupConstants, getSlotRangeForEpoch, getStartTimestampForEpoch } from '@aztec/stdlib/epoch-helpers';

import { expect, jest } from '@jest/globals';
import type { ChildProcess } from 'child_process';

import {
  applyNetworkShaping,
  applyValidatorKill,
  awaitL2BlockNumber,
  getGitProjectRoot,
  getL1DeploymentAddresses,
  getPublicViemClient,
  installTransferBot,
  restartBot,
  setupEnvironment,
  startPortForwardForRPC,
  uninstallTransferBot,
  updateSequencersConfig,
} from './utils.js';

describe('validator suppression + nuke under netem with slashing assertions', () => {
  jest.setTimeout(90 * 60 * 1000); // 90 minutes

  const logger = createLogger('e2e:spartan:suppress-nuke-slash');
  const config = setupEnvironment(process.env);
  const forwardProcesses: ChildProcess[] = [];

  let client: ViemPublicClient;
  let rollup: RollupContract;
  let constants: Omit<L1RollupConstants, 'ethereumSlotDuration'>;
  let slashSettings: TallySlasherSettings;
  let monitor: ChainMonitor;
  let nodeRpcUrl: string;
  let spartanDir: string;
  let l1ExecutionUrl: string;

  beforeAll(async () => {
    const { process: rpcProc, port } = await startPortForwardForRPC(config.NAMESPACE);
    forwardProcesses.push(rpcProc);
    nodeRpcUrl = `http://127.0.0.1:${port}`;

    const deployAddresses = await getL1DeploymentAddresses(config);
    const viem = await getPublicViemClient(config, forwardProcesses);
    client = viem.client;
    l1ExecutionUrl = viem.url;

    rollup = new RollupContract(client, deployAddresses.rollupAddress);
    monitor = new ChainMonitor(rollup, undefined, logger.createChild('chain-monitor'), 500).start();

    constants = await rollup.getRollupConstants();
    slashSettings = await getTallySlasherSettings(rollup);

    spartanDir = `${getGitProjectRoot()}/spartan`;

    // Keep a small amount of L2 traffic flowing
    await installTransferBot({
      namespace: config.NAMESPACE,
      spartanDir,
      logger,
      replicas: 1,
      txIntervalSeconds: 10,
      followChain: 'PENDING',
    });

    // Apply network shaping (Chaos Mesh) for the entire run
    await applyNetworkShaping({
      valuesFile: 'network-requirements.yaml',
      namespace: config.NAMESPACE,
      spartanDir,
      logger,
    });

    await restartBot(config.NAMESPACE, logger);
    await monitor.run();
  });

  afterAll(async () => {
    // Ensure we don't leave validators disabled
    await updateSequencersConfig(config, { disabledValidators: [] }).catch(() => undefined);
    await uninstallTransferBot(config.NAMESPACE, logger);
    monitor.removeAllListeners();
    await monitor.stop();
    forwardProcesses.forEach(p => p.kill());
  });

  it('suppresses next-epoch committee, nukes repeatedly, and all suppressed validators are slashed; then resumes with no missed slots', async () => {
    // Node and cheat codes for convenience in L2 block progress checks
    const node = createAztecNodeClient(nodeRpcUrl);
    const ethCheatCodes = new EthCheatCodesWithState([l1ExecutionUrl], new DateProvider());
    const rollupCheatCodes = new RollupCheatCodes(
      ethCheatCodes,
      await node.getNodeInfo().then(n => n.l1ContractAddresses),
    );
    const { epochDuration, slotDuration } = await rollupCheatCodes.getConfig();

    // Helper: next epoch committee discovery
    const getNextEpochCommittee = async () => {
      const startEpoch = await rollup.getCurrentEpoch();
      logger.warn(`Retrieving committee for next epoch (current epoch is ${startEpoch})`);
      return await retryUntil(
        async () => {
          const nextEpoch = (await rollup.getCurrentEpoch()) + 1n;
          const nextEpochStartTimestamp = getStartTimestampForEpoch(nextEpoch, constants);
          const committee = await rollup.getCommitteeAt(nextEpochStartTimestamp);
          if (committee && committee.length > 0) {
            logger.warn(`Retrieved committee for epoch ${nextEpoch}`, { committee });
            return { committee, epoch: nextEpoch };
          }
        },
        'committee',
        constants.epochDuration * constants.slotDuration * 4, // up to 4 epochs
        1,
      );
    };

    // Find the next epoch committee we will suppress
    const { committee, epoch } = await getNextEpochCommittee();
    const committeeEthAddresses = committee.map(a => EthAddress.fromString(a));

    // Wait until the last slot before the suppression epoch starts
    const lastSlotBeforeEpoch = getSlotRangeForEpoch(epoch, constants)[0] - 1n;
    logger.warn(`Waiting until slot ${lastSlotBeforeEpoch} to start suppression (current ${monitor.l2SlotNumber})`);
    await monitor.waitUntilL2Slot(lastSlotBeforeEpoch);

    // Enable inactivity slashing and suppress the entire upcoming committee for a full epoch
    const inactivityPenalty = slashSettings.slashingAmounts[0];
    const slashConfig: Partial<SlasherConfig> = {
      slashSelfAllowed: true,
      slashValidatorsNever: [],
      slashInactivityPenalty: inactivityPenalty,
      slashInactivityTargetPercentage: 0.7,
    };
    await updateSequencersConfig(config, { ...slashConfig, disabledValidators: committeeEthAddresses });

    // Wait until the end of the suppression epoch
    const lastSlotBeforeNextEpoch = getSlotRangeForEpoch(epoch + 1n, constants)[0] - 1n;
    logger.warn(`Waiting until end of suppressed epoch at slot ${lastSlotBeforeNextEpoch}`);
    await monitor.waitUntilL2Slot(lastSlotBeforeNextEpoch);

    // Re-enable validators
    await updateSequencersConfig(config, { disabledValidators: [] });
    logger.warn(`Re-enabled validators after suppression epoch`);

    // Record pre-slash views for all suppressed validators
    const beforeByValidator = new Map(
      await Promise.all(
        committeeEthAddresses.map(async addr => {
          const view = await rollup.getAttesterView(addr);
          return [addr.toString(), view] as const;
        }),
      ),
    );

    // Give a moment before the nuke bursts to ensure nodes haven't fully recovered
    await sleep(5_000);

    // Repeated nukes; allow recovery each time; keep netem active throughout
    const rounds = 4; // 3–5
    for (let i = 0; i < rounds; i++) {
      logger.info(`nuke round ${i + 1}/${rounds}`);
      await applyValidatorKill({
        namespace: config.NAMESPACE,
        spartanDir,
        logger,
      });

      // Wait for at least one pending block to be produced again
      const controlTips = await rollupCheatCodes.getTips();
      const timeoutSeconds = Math.ceil(Number(epochDuration * slotDuration) * 2);
      await awaitL2BlockNumber(rollupCheatCodes, controlTips.pending + 1n, timeoutSeconds, logger);
    }

    // Helper: compute generous slash timeout (mirrors slash_inactivity.test.ts)
    const getTotalSlashDelayInSeconds = () => {
      const { slashingOffsetInRounds, slashingExecutionDelayInRounds, slashingRoundSizeInEpochs } = slashSettings;
      const epochSeconds = Number(constants.epochDuration * constants.slotDuration);
      const totalEpochs = slashingRoundSizeInEpochs * (slashingOffsetInRounds + slashingExecutionDelayInRounds + 1);
      return epochSeconds * totalEpochs;
    };
    const slashTimeout = getTotalSlashDelayInSeconds() + 60; // add safety margin

    // Wait for slash events for each previously-suppressed validator
    const waitForSlash = (who: EthAddress, timeoutSeconds: number) => {
      const pr = promiseWithResolvers<{ amount: bigint; attester: EthAddress }>();
      const unsubscribe = rollup.listenToSlash(data => {
        if (data.attester.equals(who)) {
          logger.warn(`Validator ${who.toString()} slashed for ${data.amount}`);
          unsubscribe();
          pr.resolve({ amount: data.amount, attester: data.attester });
        }
      });
      const to = setTimeout(() => pr.reject(new Error(`slash timeout for ${who.toString()}`)), timeoutSeconds * 1000);
      return pr.promise.finally(() => clearTimeout(to));
    };

    const slashEvents = await Promise.all(committeeEthAddresses.map(addr => waitForSlash(addr, slashTimeout)));

    // Validate slash amounts and effective balance deltas
    const localThreshold = await rollup.getLocalEjectionThreshold();
    for (const ev of slashEvents) {
      const before = beforeByValidator.get(ev.attester.toString())!;
      const expectedBurn = before.effectiveBalance < inactivityPenalty ? before.effectiveBalance : inactivityPenalty;
      expect(ev.amount).toEqual(expectedBurn);

      const after = await rollup.getAttesterView(ev.attester);
      const slashed = before.effectiveBalance - after.effectiveBalance;
      const expectedBalanceDrop =
        before.effectiveBalance - inactivityPenalty < localThreshold ? before.effectiveBalance : inactivityPenalty;
      expect(slashed).toEqual(expectedBalanceDrop);
    }

    // Final assertion: we resume with no missed slots for the next full epoch
    const resumeEpoch = (await rollup.getCurrentEpoch()) + 1n;
    const resumeEpochStart = getSlotRangeForEpoch(resumeEpoch, constants)[0];
    await monitor.waitUntilL2Slot(resumeEpochStart);

    const startTips = await rollupCheatCodes.getTips();
    const resumeEpochEndLastSlot = getSlotRangeForEpoch(resumeEpoch + 1n, constants)[0] - 1n;
    await monitor.waitUntilL2Slot(resumeEpochEndLastSlot);
    const endTips = await rollupCheatCodes.getTips();

    const expectedBlocks = BigInt(Math.floor(Number(epochDuration)));
    const producedBlocks = endTips.pending - startTips.pending;
    const missed = Number(expectedBlocks - producedBlocks);

    logger.info(`resume epoch produced=${producedBlocks} expected=${expectedBlocks} missed=${missed}`);
    expect(missed).toBe(0);
  });
});
