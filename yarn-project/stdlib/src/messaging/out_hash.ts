import { OUT_HASH_TREE_LEAF_COUNT } from '@aztec/constants';
import { padArrayEnd } from '@aztec/foundation/collection';
import { Fr } from '@aztec/foundation/fields';
import {
  computeBalancedShaRoot,
  computeCompressedUnbalancedShaRoot,
  computeUnbalancedShaRoot,
} from '@aztec/foundation/trees';

export function computeTxOutHash(messages: Fr[]): Fr {
  if (!messages.length) {
    return Fr.ZERO;
  }
  // Tx out hash is the root of the unbalanced merkle tree of all the messages.
  // Zero hashes (which should not happen) are not compressed.
  return Fr.fromBuffer(computeUnbalancedShaRoot(messages.map(msg => msg.toBuffer())));
}

export function computeBlockOutHash(messagesPerTx: Fr[][]): Fr {
  const txOutHashes = messagesPerTx.map(messages => computeTxOutHash(messages));
  return aggregateOutHashes(txOutHashes);
}

export function computeCheckpointOutHash(messagesPerBlock: Fr[][][]): Fr {
  const blockOutHashes = messagesPerBlock.map(block => computeBlockOutHash(block));
  return aggregateOutHashes(blockOutHashes);
}

export function computeEpochOutHash(messagesPerCheckpoint: Fr[][][][]): Fr {
  // Must match the implementation in `compute_epoch_out_hash.nr`.
  const checkpointOutHashes = messagesPerCheckpoint.map(checkpoint => computeCheckpointOutHash(checkpoint));
  return computeEpochOutHashFromCheckpointOutHashes(checkpointOutHashes);
}

export function computeEpochOutHashFromCheckpointOutHashes(checkpointOutHashes: Fr[]): Fr {
  const paddedOutHashes = padArrayEnd(
    checkpointOutHashes.map(hash => hash.toBuffer()),
    Buffer.alloc(32),
    OUT_HASH_TREE_LEAF_COUNT,
  );
  return Fr.fromBuffer(computeBalancedShaRoot(paddedOutHashes));
}

// The root of this tree should match the `out_hash` calculated in the circuits. Zero hashes are compressed to reduce
// cost if the non-zero leaves result in a shorter path.
function aggregateOutHashes(outHashes: Fr[]): Fr {
  if (!outHashes.length) {
    return Fr.ZERO;
  }

  return Fr.fromBuffer(computeCompressedUnbalancedShaRoot(outHashes.map(hash => hash.toBuffer())));
}
