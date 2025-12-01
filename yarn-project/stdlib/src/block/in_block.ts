import { type ZodTypeAny, z } from 'zod';

import { schemas } from '../schemas/index.js';
import { L2BlockHash } from './block_hash.js';
import type { L2Block } from './l2_block.js';

export type InBlock = {
  l2BlockNumber: number;
  l2BlockHash: L2BlockHash;
};

// Note: If you expand this type with indexInBlock, then delete `IndexedTxEffect` and use this type instead.
export type DataInBlock<T> = {
  data: T;
} & InBlock;

export function randomInBlock(): InBlock {
  return {
    l2BlockNumber: Math.floor(Math.random() * 1000),
    l2BlockHash: L2BlockHash.random(),
  };
}

export function randomDataInBlock<T>(data: T): DataInBlock<T> {
  return {
    ...randomInBlock(),
    data,
  };
}

// TODO(martin): deal with L2Block deprecation
export async function wrapDataInBlock<T>(data: T, block: L2Block): Promise<DataInBlock<T>> {
  return {
    data,
    l2BlockNumber: block.number,
    l2BlockHash: L2BlockHash.fromField(await block.hash()),
  };
}

export function dataInBlockSchemaFor<T extends ZodTypeAny>(schema: T) {
  return z.object({
    data: schema,
    l2BlockNumber: schemas.Integer,
    l2BlockHash: L2BlockHash.schema,
  });
}
