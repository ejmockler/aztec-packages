use dep::protocol_types::{
    address::AztecAddress,
    constants::GENERATOR_INDEX__NOTE_HASH,
    hash::poseidon2_hash_with_separator,
    traits::{Hash, Serialize},
};

use crate::{
    context::{PrivateContext, UtilityContext},
    keys::getters::{get_nsk_app, get_public_keys},
    oracle::notes::check_nullifier_exists,
    state_vars::storage::HasStorageSlot,
};

mod test;

/// # SingleUseClaim
///
/// A private state variable type that represents a right a user can exercise at most once.
///
/// You can declare a `SingleUseClaim` state variable within your contract's `#[storage]` struct:
///
/// `your_action: SingleUseClaim<ClaimIdentifier, Context>`
///
/// Where `ClaimIdentifier` is a generic argument, typically a struct provided by the contract developer,
/// whose only requirement is to implement the `Serializable` trait.
///
/// A `ClaimIdentifier` uniquely describes a single-use entitlement in the application domain
/// (e.g. which voting session, which credential, which proposal, etc).
///
/// ## Functions
/// - `at(owner: AztecAddress)`: scopes the claim to the given owner,
/// just like `Map#at(address)` gets state specifically related to a given address).
/// Returns a `SingleUseClaimWithOwner`.
///
/// ### Functions scoped to an owner (i.e. `SingleUseClaimWithOwner` functions)
///
/// #### Private functions
/// - `claim(claim_id: ClaimIdentifier)`: records that the owner has exercise the given claim. Emits a nullifier.
/// - `assert_claimed(claim_id: ClaimIdentifier)`: fails if the owner has not yet exercised the given claim.
/// Validates existence of a nullifier.
///
/// #### Utility functions
/// - `is_done(claim_id: ClaimIdentifier) -> bool`: returns whether the owner has exercised the given claim.
/// Checks existence of a nullifier.
///
/// ## Example
///
/// The right to vote at most once can be implemented using `SingleUseClaim` as a primitive.
///
/// ```noir
/// // We define `Vote` as the `ClaimIdentifier` type.
/// // In this example we are only coordinating a single voting process,
/// // but the `Vote` type might as well define an `id` attribute which
/// // would then be used to track whether a given user has voted on a given
/// // voting process.
/// #[derive(Serialize)]
/// struct Vote {}
///
/// #[storage]
/// struct Storage<Context> {
///     tally: Map<Field, PublicMutable<Field, Context>, Context>, // key: candidate, value: number of votes
///     vote_claims: SingleUseClaim<Vote, Context>, // ensure that each user can only vote once
/// }
///
/// #[external("private")]
/// fn cast_vote(candidate: Field) {
///     let voter = self.msg_sender().unwrap();
///
///     // `claim` will only succeed if `voter` hasn't ever run this before.
///     self.storage.vote_claims.at(voter).claim(Vote {});
///
///     // Now that we checked that the voter is entitled to vote,
///     // we can enqueue the corresponding public effect
///     self.enqueue_self.add_to_tally_public(candidate);
/// }
/// ```
pub struct SingleUseClaim<ClaimIdentifier, Context> {
    context: Context,
    storage_slot: Field,
}

/// Represents the SingleUseClaim scoped to an owner address.
/// See: SingleUseClaim::at.
pub struct SingleUseClaimWithOwner<ClaimIdentifier, Context> {
    context: Context,
    storage_slot: Field,
    owner: AztecAddress,
}

// Private storage slots are not really 'slots' but rather a value in the nullifier hash preimage,
// so there is no notion of a value spilling over multiple slots.
// For this reason SingleUseClaim (just as any other private state variable) needs
// just one slot to be reserved, regardless of what it stores.
impl<ClaimIdentifier, Context> HasStorageSlot<1> for SingleUseClaim<ClaimIdentifier, Context> {
    fn get_storage_slot(self) -> Field {
        self.storage_slot
    }
}

impl<ClaimIdentifier, Context> SingleUseClaim<ClaimIdentifier, Context> {
    /// Initializes a new SingleUseClaim state variable.
    /// This function is usually automatically called within the `#[storage]` macro.
    /// You typically don't need to call this directly when writing smart contracts.
    ///
    /// # Arguments
    ///
    /// * `context` - One of `PrivateContext`/`PublicContext`/`UtilityContext`. The
    ///               Context determines which methods of this struct will be made
    ///               available to the calling smart contract function.
    /// * `storage_slot` - A unique identifier for this state variable within the
    ///                    contract. The nullifier for this SingleUseClaim
    ///                    state variable will have this `storage_slot`.
    ///                    Usually, the `#[storage]` macro will determine an
    ///                    appropriate `storage_slot` automatically. A smart contract
    ///                    dev shouldn't have to worry about this, as it's managed
    ///                    behind the scenes.
    ///
    /// docs:start:new
    pub fn new(context: Context, storage_slot: Field) -> Self {
        assert(storage_slot != 0, "Storage slot 0 not allowed. Storage slots must start from 1.");
        Self { context, storage_slot }
    }

    /// Returns a SingleUseClaimWithOwner instance, which is the original
    /// SingleUseClaim state variable scoped to the given owner address.
    ///
    /// The SingleUseClaim state can then be written by calling `claim` on it, or read
    /// via `has_claimed` (utility function), or `assert_claimed` (private function).
    ///
    /// # Arguments
    ///
    /// * `owner` - The AztecAddress to which we scope this variable.
    ///
    /// # Returns
    ///
    /// * `SingleUseClaimWithOwner` - The original `SingleUseClaimWithOwner` augmented with an `owner` attribute.
    ///         You can then call methods like `.claim()`, `.assert_claimed()`, `.has_claimed()`, etc. which
    ///         are scoped to the given owner address.
    ///
    /// # Example
    ///
    /// ```noir
    /// // Continue execution only if owner hasn't acted upon this variable before
    /// self.storage.some_single_use_claim.at(owner).do(...);
    /// self.enqueue.some_effect();
    /// ```
    ///
    pub fn at(self, owner: AztecAddress) -> SingleUseClaimWithOwner<ClaimIdentifier, Context> {
        SingleUseClaimWithOwner { context: self.context, storage_slot: self.storage_slot, owner }
    }
}

impl<ClaimIdentifier, Context> SingleUseClaimWithOwner<ClaimIdentifier, Context>
where
    ClaimIdentifier: Serialize,
{
    /// Computes the nullifier that will be created when the given claim_id is claimed
    /// by the owner (denoted by the app-siloed nullifier secret key `owner_nsk_app`).
    ///
    /// This function is primarily used internally by functions `claim`, `assert_claimed` and
    /// `has_claimed` to coherently write and read state.
    ///
    /// # Returns
    ///
    /// * `Field` - The nullifier that will be emitted when `owner` claims the `claim_id`.
    ///
    fn compute_nullifier(self, claim_id: ClaimIdentifier, owner_nsk_app: Field) -> Field {
        // TODO(F-180): make sure we follow the nullifier convention
        poseidon2_hash_with_separator(
            claim_id.serialize().concat([owner_nsk_app, self.storage_slot]),
            GENERATOR_INDEX__NOTE_HASH,
        )
    }
}

impl<ClaimIdentifier> SingleUseClaimWithOwner<ClaimIdentifier, &mut PrivateContext>
where
    ClaimIdentifier: Serialize,
{
    /// Records the fact that the owner in scope has claimed `claim_id`. This function succeeds at most once
    /// for a given `<owner, claim_id>` combination. Any subsequent calls with same
    /// inputs are guaranteed to fail.
    ///
    /// ## Arguments
    ///
    /// * `claim_id` - An instance of a `Serializable` type used to differentiate single-use entitlements.
    ///     At its simplest, said type could be an empty struct which means this state variable
    ///     can only track one type of claim. However, arbitrarily richer claim identifier structs
    ///     are supported. For example defining a `struct MyClaim { id: Field }` would let you
    ///     use this single state variable to track claims along different kinds of claims each with
    ///     their own `id`.
    ///
    /// ## Advanced
    ///
    /// The implementation of this function emits a nullifier derived from
    /// the `owner`'s nullifier secret key, a storage slot, and the `claim_id` to be marked.
    ///
    /// Any subsequent attempts at calling this function with the same owner and claim_id
    /// combination are guaranteed by the protocol to fail (since it would result in duplicate
    /// nullifiers), which is why this function provides `at most once execution` semantics.
    pub fn claim(self, claim_id: ClaimIdentifier) {
        let owner_nsk_app = self.context.request_nsk_app(get_public_keys(self.owner).npk_m.hash());
        self.context.push_nullifier(self.compute_nullifier(claim_id, owner_nsk_app));
    }

    /// Asserts that the owner has claimed `claim_id`.
    ///
    /// ## Arguments
    ///
    /// * `claim_id` - An instance of a `Serializable` type used to differentiate single-use entitlements.
    ///     At its simplest, said type could be an empty struct which means this state variable
    ///     can only track one type of claim. However, arbitrarily richer claim identifier structs
    ///     are supported. For example defining a `struct MyClaim { id: Field }` would let you
    ///     use this single state variable to track claims along different kinds of claims each with
    ///     their own `id`.
    ///
    /// ## Advanced
    ///
    /// The implementation of this function computes a nullifier derived from
    /// the `owner`'s nullifier secret key, the state variable's storage slot, and the param `claim_id`.
    ///
    /// It then pushes a request to find the nullifier in private state, including nullifiers emitted
    /// during the current transaction (also known as _transient nullifiers_). This request will
    /// _eventually cause_ the current transaction simulation/proving to fail if the nullifier
    /// is not found, which guarantees any private function using this call will fail unless
    /// `owner` claimed the given `claim_id`.
    pub fn assert_claim(self, claim_id: ClaimIdentifier) {
        let owner_nsk_app = self.context.request_nsk_app(get_public_keys(self.owner).npk_m.hash());
        let nullifier = self.compute_nullifier(claim_id, owner_nsk_app);
        self.context.push_nullifier_read_request(nullifier, self.context.this_address())
    }
}

impl<ClaimIdentifier> SingleUseClaimWithOwner<ClaimIdentifier, UtilityContext>
where
    ClaimIdentifier: Serialize,
{
    /// Returns whether an owner has claimed `claim_id`.
    ///
    /// ## Arguments
    ///
    /// * `claim_id` - An instance of a `Serializable` type used to differentiate single-use entitlements.
    ///     At its simplest, said type could be an empty struct which means this state variable
    ///     can only track one type of claim. However, arbitrarily richer claim identifier structs
    ///     are supported. For example defining a `struct MyClaim { id: Field }` would let you
    ///     use this single state variable to track claims along different kinds of claims each with
    ///     their own `id`.
    ///
    /// ## Returns
    ///
    /// * `true` - If the param `claim_id` was claimed by `owner`.
    /// * `false` - Otherwise.
    ///
    /// ## Advanced
    ///
    /// The implementation of this function computes a nullifier derived from
    /// the `owner`'s nullifier secret key, the state variable's storage slot, and the param `claim_id`.
    ///
    /// It then requests PXE to find the nullifier in private state, including nullifiers emitted
    /// during the current transaction (also known as _transient nullifiers_).
    pub unconstrained fn has_claimed(self, claim_id: ClaimIdentifier) -> bool {
        let owner_nsk_app = get_nsk_app(get_public_keys(self.owner).npk_m.hash());
        check_nullifier_exists(self.compute_nullifier(claim_id, owner_nsk_app))
    }
}
