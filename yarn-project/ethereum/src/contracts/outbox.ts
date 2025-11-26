import { EthAddress } from '@aztec/foundation/eth-address';
import { OutboxAbi } from '@aztec/l1-artifacts/OutboxAbi';

import { type GetContractReturnType, type Hex, encodeAbiParameters, getContract, hexToBigInt, keccak256 } from 'viem';

import { getPublicClient } from '../client.js';
import type { DeployL1ContractsReturnType } from '../deploy_l1_contracts.js';
import type { L1ReaderConfig } from '../l1_reader.js';
import { type ExtendedViemWalletClient, type ViemClient, isExtendedClient } from '../types.js';

export type ViemL1Actor = {
  actor: Hex;
  chainId: bigint;
};

export type ViemL2Actor = {
  actor: Hex;
  version: bigint;
};

export type ViemL2ToL1Msg = {
  sender: ViemL2Actor;
  recipient: ViemL1Actor;
  content: Hex;
};

export class OutboxContract {
  private readonly outbox: GetContractReturnType<typeof OutboxAbi, ViemClient>;

  static getFromL1ContractsValues(deployL1ContractsValues: DeployL1ContractsReturnType) {
    const {
      l1Client,
      l1ContractAddresses: { outboxAddress },
    } = deployL1ContractsValues;
    return new OutboxContract(l1Client, outboxAddress.toString());
  }

  static getFromConfig(config: L1ReaderConfig) {
    const client = getPublicClient(config);
    const address = config.l1Contracts.outboxAddress.toString();
    return new OutboxContract(client, address);
  }

  static getEpochRootStorageSlot(epoch: bigint) {
    return hexToBigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [epoch, 0n])));
  }

  constructor(
    public readonly client: ViemClient,
    address: Hex | EthAddress,
  ) {
    if (address instanceof EthAddress) {
      address = address.toString();
    }
    this.outbox = getContract({ address, abi: OutboxAbi, client });
  }

  public get address() {
    return this.outbox.address;
  }

  public getContract(): GetContractReturnType<typeof OutboxAbi, ViemClient> {
    return this.outbox;
  }

  public hasMessageBeenConsumedAtEpoch(epoch: bigint, leafId: bigint) {
    return this.outbox.read.hasMessageBeenConsumedAtEpoch([epoch, leafId]);
  }

  public getRootData(epoch: bigint) {
    return this.outbox.read.getRootData([epoch]);
  }

  public consume(message: ViemL2ToL1Msg, epoch: bigint, leafIndex: bigint, path: Hex[]) {
    const wallet = this.assertWallet();
    return wallet.write.consume([message, epoch, leafIndex, path]);
  }

  public async getMessageConsumedEvents(
    l1BlockHash: Hex,
  ): Promise<{ epoch: bigint; root: Hex; messageHash: Hex; leafId: bigint }[]> {
    const events = await this.outbox.getEvents.MessageConsumed({}, { blockHash: l1BlockHash, strict: true });
    return events.map(event => ({
      epoch: event.args.epoch!,
      root: event.args.root!,
      messageHash: event.args.messageHash!,
      leafId: event.args.leafId!,
    }));
  }

  private assertWallet(): GetContractReturnType<typeof OutboxAbi, ExtendedViemWalletClient> {
    if (!isExtendedClient(this.client)) {
      throw new Error('Wallet client is required for this operation');
    }
    return this.outbox as GetContractReturnType<typeof OutboxAbi, ExtendedViemWalletClient>;
  }
}
