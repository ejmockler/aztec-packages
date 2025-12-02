---
title: Partial Notes
sidebar_position: 1
tags: [Developers, Contracts, Notes]
description: How partial notes work and how they can be used.
---

import Image from "@theme/IdealImage";

## What are Partial Notes?

Partial notes are notes created with incomplete data, usually during private execution, which can be completed with additional information that becomes available later, usually during public execution.

Let’s say, for example, I have a `UintNote`:

```rust
pub struct UintNote {
    owner: AztecAddress,    // Private field
    randomness: Field,      // Private field
    value: u128,            // Public field
}
```

When creating the note locally, while in private execution, the `owner` is known, but the `value` potentially is not, e.g., it is some onchain dynamic variable. First, a **partial note** can be created during private execution that contains the `owner` and `randomness`, and then the note is *”completed”* to create a full note by later adding the `value` field, usually during public execution.

<Image img={require("@site/static/img/partial-notes.png")} />

## Use Cases

Partial notes are useful when a e.g., part of the note struct is a value that depends on dynamic, public onchain data that isn't available during private execution, such as:

- AMM swap prices
- Current gas prices
- Time-dependent interest accrual

## Implementation

All notes contain partial notes and use nested hash commitments. This is best explained using an example.

### Note Structure Example

Consider the `UintNote` structure again:

```rust
pub struct UintNote {
    owner: AztecAddress,    // Private field
    randomness: Field,       // Private field
    value: u128,            // Public field
}

```

### Two-Phase Commitment Process

**Phase 1: Partial Commitment (Private Execution)**

The private fields are committed during local execution:

```rust
let commitment = UintPartialNotePrivateContent { owner, randomness }
    .compute_partial_commitment(storage_slot);

fn compute_partial_commitment(self, storage_slot: Field) -> Field {
    poseidon2_hash_with_separator(
        self.pack().concat([storage_slot]),
        GENERATOR_INDEX__NOTE_HASH,
    )
}

```

Here, we are creating a partial note commitment:

```
partial_commitment = H(partial_commitment, value)
```

**Phase 2: Note Completion (Public Execution)**

The sequencer completes the note by hashing the partial commitment with the public value:

```rust
fn compute_complete_note_hash(self, value: u128) -> Field {
    poseidon2_hash_with_separator(
        [self.commitment, value.to_field()],
        GENERATOR_INDEX__NOTE_HASH,
    )
}

```

The resulting structure is a nested commitment:

```
note_hash = H(H(owner, randomness, storage_slot), value)
          = H(partial_commitment, value)

```

## Universal Note Format

All notes in Aztec use the partial note format internally, even when all data is known during private execution. This ensures consistent note hash computation regardless of how the note was created.

When a note is created with all fields known:

1. A partial commitment is computed from the initial fields
2. The partial commitment is immediately completed with the other field

```rust
fn compute_note_hash(self, storage_slot: Field) -> Field {
    // Step 1: Create partial note from private content
    let private_content =
        UintPartialNotePrivateContent { owner: self.owner, randomness: self.randomness };
    let partial_note = PartialUintNote {
        commitment: private_content.compute_partial_commitment(storage_slot),
    };

    // Step 2: Complete the note hash with public value
    partial_note.compute_complete_note_hash(self.value)
}

```

This two-step process ensures that notes with identical field values produce identical note hashes, regardless of whether they were created as partial notes or complete notes.

<Image img={require("@site/static/img/shrek.jpeg")} />

## Partial Notes in Practice

To understand how to use partial notes in practice, [this AMM contract](https://github.com/AztecProtocol/aztec-packages/tree/next/noir-projects/noir-contracts/contracts/app/amm_contract) uses partial notes to initiate and complete the swap of `token1` to `token2`. Since the exchange rate is onchain, it cannot be known ahead of time while executing in private so a full note cannot be created. Instead, a partial note is created for the `owner` swapping the tokens. This partial note is then completed during public execution once the exchange rate can be read.
