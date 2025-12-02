import { BlockNumber } from '@aztec/foundation/branded-types';

import { describe, expect, it } from '@jest/globals';

import { INITIAL_L2_BLOCK_NUM, INITIAL_L2_BLOCK_NUM_TYPED } from './constants.js';

describe('Constants', () => {
  describe('Block Number Constants', () => {
    it('INITIAL_L2_BLOCK_NUM should be 1', () => {
      expect(INITIAL_L2_BLOCK_NUM).toBe(1);
    });

    it('INITIAL_L2_BLOCK_NUM_TYPED should be properly typed as BlockNumber', () => {
      expect(INITIAL_L2_BLOCK_NUM_TYPED).toBe(1);

      // Verify it's a valid BlockNumber
      expect(BlockNumber.isValid(INITIAL_L2_BLOCK_NUM_TYPED)).toBe(true);

      // Verify it's assignable to number
      const asNumber: number = INITIAL_L2_BLOCK_NUM_TYPED;
      expect(asNumber).toBe(1);
    });

    it('INITIAL_L2_BLOCK_NUM_TYPED should equal INITIAL_L2_BLOCK_NUM value', () => {
      expect(INITIAL_L2_BLOCK_NUM_TYPED).toBe(INITIAL_L2_BLOCK_NUM);
    });
  });
});
