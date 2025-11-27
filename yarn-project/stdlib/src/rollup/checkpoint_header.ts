import type { ViemHeader } from '@aztec/ethereum';
import { sha256ToField } from '@aztec/foundation/crypto';
import { EthAddress } from '@aztec/foundation/eth-address';
import { Fr } from '@aztec/foundation/fields';
import type { ZodFor } from '@aztec/foundation/schemas';
import { BufferReader, bigintToUInt64BE, serializeToBuffer } from '@aztec/foundation/serialize';
import { bufferToHex, hexToBuffer } from '@aztec/foundation/string';
import type { FieldsOf } from '@aztec/foundation/types';

import { inspect } from 'util';
import { z } from 'zod';

import { AztecAddress } from '../aztec-address/index.js';
import { GasFees } from '../gas/index.js';
import { schemas } from '../schemas/index.js';
import type { UInt64 } from '../types/shared.js';

export class CheckpointHeader {
  constructor(
    /** Root of the archive tree before this block is added. */
    public lastArchiveRoot: Fr,
    /** Hash of the headers of all blocks in this checkpoint. */
    public blockHeadersHash: Fr,
    /** Hash of the blobs in the checkpoint. */
    public blobsHash: Fr,
    /** Root of the l1 to l2 messages subtree. */
    public inHash: Fr,
    /** Root of the epoch out hash tree. Leaves are the out hashes of this checkpoint and all previous checkpoints. */
    public outHashRoot: Fr,
    /** Slot number of the L2 block */
    public slotNumber: Fr,
    /** Timestamp of the L2 block. */
    public timestamp: UInt64,
    /** Recipient of block reward. */
    public coinbase: EthAddress,
    /** Address to receive fees. */
    public feeRecipient: AztecAddress,
    /** Global gas prices for this block. */
    public gasFees: GasFees,
    /** Total mana used in the block, computed by the root rollup circuit */
    public totalManaUsed: Fr,
  ) {}

  static get schema(): ZodFor<CheckpointHeader> {
    return z
      .object({
        lastArchiveRoot: schemas.Fr,
        blockHeadersHash: schemas.Fr,
        blobsHash: schemas.Fr,
        inHash: schemas.Fr,
        outHashRoot: schemas.Fr,
        slotNumber: schemas.Fr,
        timestamp: schemas.BigInt,
        coinbase: schemas.EthAddress,
        feeRecipient: schemas.AztecAddress,
        gasFees: GasFees.schema,
        totalManaUsed: schemas.Fr,
      })
      .transform(CheckpointHeader.from);
  }

  static getFields(fields: FieldsOf<CheckpointHeader>) {
    return [
      fields.lastArchiveRoot,
      fields.blockHeadersHash,
      fields.blobsHash,
      fields.inHash,
      fields.outHashRoot,
      fields.slotNumber,
      fields.timestamp,
      fields.coinbase,
      fields.feeRecipient,
      fields.gasFees,
      fields.totalManaUsed,
    ] as const;
  }

  static from(fields: FieldsOf<CheckpointHeader>) {
    return new CheckpointHeader(...CheckpointHeader.getFields(fields));
  }

  static fromBuffer(buffer: Buffer | BufferReader) {
    const reader = BufferReader.asReader(buffer);

    return new CheckpointHeader(
      reader.readObject(Fr),
      reader.readObject(Fr),
      reader.readObject(Fr),
      reader.readObject(Fr),
      reader.readObject(Fr),
      Fr.fromBuffer(reader),
      reader.readUInt64(),
      reader.readObject(EthAddress),
      reader.readObject(AztecAddress),
      reader.readObject(GasFees),
      reader.readObject(Fr),
    );
  }

  equals(other: CheckpointHeader) {
    return (
      this.lastArchiveRoot.equals(other.lastArchiveRoot) &&
      this.blockHeadersHash.equals(other.blockHeadersHash) &&
      this.blobsHash.equals(other.blobsHash) &&
      this.inHash.equals(other.inHash) &&
      this.outHashRoot.equals(other.outHashRoot) &&
      this.slotNumber.equals(other.slotNumber) &&
      this.timestamp === other.timestamp &&
      this.coinbase.equals(other.coinbase) &&
      this.feeRecipient.equals(other.feeRecipient) &&
      this.gasFees.equals(other.gasFees) &&
      this.totalManaUsed.equals(other.totalManaUsed)
    );
  }

  toBuffer() {
    // Note: The order here must match the order in the ProposedHeaderLib solidity library.
    return serializeToBuffer([
      this.lastArchiveRoot,
      this.blockHeadersHash,
      this.blobsHash,
      this.inHash,
      this.outHashRoot,
      this.slotNumber,
      bigintToUInt64BE(this.timestamp),
      this.coinbase,
      this.feeRecipient,
      this.gasFees,
      this.totalManaUsed,
    ]);
  }

  hash(): Fr {
    return sha256ToField([this.toBuffer()]);
  }

  static empty(fields: Partial<FieldsOf<CheckpointHeader>> = {}) {
    return CheckpointHeader.from({
      lastArchiveRoot: Fr.ZERO,
      blockHeadersHash: Fr.ZERO,
      blobsHash: Fr.ZERO,
      inHash: Fr.ZERO,
      outHashRoot: Fr.ZERO,
      slotNumber: Fr.ZERO,
      timestamp: 0n,
      coinbase: EthAddress.ZERO,
      feeRecipient: AztecAddress.ZERO,
      gasFees: GasFees.empty(),
      totalManaUsed: Fr.ZERO,
      ...fields,
    });
  }

  static random(): CheckpointHeader {
    return new CheckpointHeader(
      Fr.random(),
      Fr.random(),
      Fr.random(),
      Fr.random(),
      Fr.random(),
      new Fr(BigInt(Math.floor(Math.random() * 1000) + 1)),
      BigInt(Math.floor(Date.now() / 1000)),
      EthAddress.random(),
      new AztecAddress(Fr.random()),
      GasFees.random(),
      new Fr(BigInt(Math.floor(Math.random() * 1000000))),
    );
  }

  isEmpty(): boolean {
    return (
      this.lastArchiveRoot.isZero() &&
      this.blockHeadersHash.isZero() &&
      this.blobsHash.isZero() &&
      this.inHash.isZero() &&
      this.outHashRoot.isZero() &&
      this.slotNumber.isZero() &&
      this.timestamp === 0n &&
      this.coinbase.isZero() &&
      this.feeRecipient.isZero() &&
      this.gasFees.isEmpty() &&
      this.totalManaUsed.isZero()
    );
  }

  /**
   * Serializes this instance into a string.
   * @returns Encoded string.
   */
  public toString() {
    return bufferToHex(this.toBuffer());
  }

  static fromString(str: string) {
    return CheckpointHeader.fromBuffer(hexToBuffer(str));
  }

  static fromViem(header: ViemHeader) {
    return new CheckpointHeader(
      Fr.fromString(header.lastArchiveRoot),
      Fr.fromString(header.blockHeadersHash),
      Fr.fromString(header.blobsHash),
      Fr.fromString(header.inHash),
      Fr.fromString(header.outHash),
      new Fr(header.slotNumber),
      header.timestamp,
      new EthAddress(hexToBuffer(header.coinbase)),
      new AztecAddress(hexToBuffer(header.feeRecipient)),
      new GasFees(header.gasFees.feePerDaGas, header.gasFees.feePerL2Gas),
      new Fr(header.totalManaUsed),
    );
  }

  toViem(): ViemHeader {
    return {
      lastArchiveRoot: this.lastArchiveRoot.toString(),
      blockHeadersHash: this.blockHeadersHash.toString(),
      blobsHash: this.blobsHash.toString(),
      inHash: this.inHash.toString(),
      outHash: this.outHashRoot.toString(),
      slotNumber: this.slotNumber.toBigInt(),
      timestamp: this.timestamp,
      coinbase: this.coinbase.toString(),
      feeRecipient: `0x${this.feeRecipient.toBuffer().toString('hex').padStart(64, '0')}`,
      gasFees: {
        feePerDaGas: this.gasFees.feePerDaGas,
        feePerL2Gas: this.gasFees.feePerL2Gas,
      },
      totalManaUsed: this.totalManaUsed.toBigInt(),
    };
  }

  toInspect() {
    return {
      lastArchive: this.lastArchiveRoot.toString(),
      blockHeadersHash: this.blockHeadersHash.toString(),
      blobsHash: this.blobsHash.toString(),
      inHash: this.inHash.toString(),
      outHashRoot: this.outHashRoot.toString(),
      slotNumber: this.slotNumber.toBigInt(),
      timestamp: this.timestamp,
      coinbase: this.coinbase.toString(),
      feeRecipient: this.feeRecipient.toString(),
      gasFees: this.gasFees.toInspect(),
      totalManaUsed: this.totalManaUsed.toBigInt(),
    };
  }

  [inspect.custom]() {
    const gasfees = `da:${this.gasFees.feePerDaGas}, l2:${this.gasFees.feePerL2Gas}`;
    return `Header {
  lastArchiveRoot: ${this.lastArchiveRoot.toString()},
  blockHeadersHash: ${this.blockHeadersHash.toString()},
  blobsHash: ${inspect(this.blobsHash)},
  inHash: ${inspect(this.inHash)},
  outHashRoot: ${inspect(this.outHashRoot)},
  slotNumber: ${this.slotNumber.toBigInt()},
  timestamp: ${this.timestamp},
  coinbase: ${this.coinbase.toString()},
  feeRecipient: ${this.feeRecipient.toString()},
  gasFees: ${gasfees},
  totalManaUsed: ${this.totalManaUsed.toBigInt()},
}`;
  }
}
