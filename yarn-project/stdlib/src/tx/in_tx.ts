import { type InBlock, randomInBlock } from '../block/in_block.js';
import { TxHash } from './tx_hash.js';

export type InTx = InBlock & {
  txHash: TxHash;
};

export function randomInTx(): InTx {
  return {
    ...randomInBlock(),
    txHash: TxHash.random(),
  };
}
