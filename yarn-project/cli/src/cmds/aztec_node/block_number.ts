import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { BlockNumber } from '@aztec/foundation/branded-types';
import type { LogFn } from '@aztec/foundation/log';

export async function blockNumber(nodeUrl: string, log: LogFn) {
  const aztecNode = createAztecNodeClient(nodeUrl);
  const [latestNumRaw, provenNumRaw] = await Promise.all([
    aztecNode.getBlockNumber(),
    aztecNode.getProvenBlockNumber(),
  ]);
  const latestNum: BlockNumber = BlockNumber(latestNumRaw);
  const provenNum: BlockNumber = BlockNumber(provenNumRaw);
  log(`Latest block: ${latestNum}`);
  log(`Proven block: ${provenNum}`);
}
