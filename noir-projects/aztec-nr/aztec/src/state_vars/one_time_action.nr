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

/// # OneTimeAction
///
/// A private state variable type that represents a topic a user can act upon at most once.
///
/// You can declare a OneTimeAction state variable within your contract's #[storage] struct:
///
/// `your_action: OneTimeAction<ACTION, Context>`
///
/// The value is represented by the existence of a nullifier derived from the contents
/// of `ACTION` and the account's nullifier key: if and only if such a nullifier exists,
/// the topic has been acted upon.
///
/// You provide a `ACTION` type, whose only requirement is to implement the `Serializable`
/// trait.
///
/// Note that this means a single `OneTimeAction` variable can track multiple topics.
///
/// ## Functions
/// - `at(owner: AztecAddress)`: scopes the variable to the given owner (similar to `Map`).
/// Returns a OneTimeActionWithOwner.
///
/// ### Functions scoped to an owner (i.e. OneTimeActionWithOwner functions)
///
/// #### Private functions
/// - `do(action: ACTION)`: marks the action as done by the owner in scope. Emits a nullifier.
/// - `assert_done(action: ACTION)`: fails if a user has not acted upon a topic.
/// Validates existence of a nullifier.
///
/// #### Utility functions
/// - `is_done(action: ACTION) -> bool`: returns whether the owner in scope has acted upon a topic.
/// Checks existence of a nullifier.
///
/// ## Example
///
/// The right to vote once can be implemented using OneTimeAction as a primitive.
///
/// ```noir
/// // We define `Vote` as the ACTION type.
/// // In this example we are only coordinating a single voting process,
/// // but the `Vote` type might as well define an `id` attribute which
/// // would then used to track whether a given user has voted on a given
/// // voting process.
/// #[derive(Serialize)]
/// struct Vote {}
///
/// #[storage]
/// struct Storage<Context> {
///     tally: Map<Field, PublicMutable<Field, Context>, Context>, // key: candidate, value: number of votes
///     vote_topic: OneTimeAction<Vote, Context>, // ensure that each user can only vote once
/// }
///
/// #[external("private")]
/// fn cast_vote(candidate: Field) {
///     let voter = self.msg_sender().unwrap();
///
///     // `do` will only succeed if `voter` hasn't ever done this.
///     self.storage.vote_topic.at(voter).do(Vote {});
///
///     // Now that we checked that the voter is entitled to vote,
///     // we can enqueue the public effect
///     self.enqueue_self.add_to_tally_public(candidate);
/// }
/// ```
pub struct OneTimeAction<ACTION, Context> {
    context: Context,
    storage_slot: Field,
}

/// Represents the OneTimeAction scoped to an owner address.
/// See: OneTimeAction::at.
pub struct OneTimeActionWithOwner<ACTION, Context> {
    context: Context,
    storage_slot: Field,
    owner: AztecAddress,
}

// Private storage slots are not really 'slots' but rather a value in the nullifier hash preimage,
// so there is no notion of a value spilling over multiple slots.
// For this reason OneTimeAction (just as any other private state variable) needs
// just one slot to be reserved, regardless of what it stores.
impl<ACTION, Context> HasStorageSlot<1> for OneTimeAction<ACTION, Context> {
    fn get_storage_slot(self) -> Field {
        self.storage_slot
    }
}

impl<ACTION, Context> OneTimeAction<ACTION, Context> {
    /// Initializes a new OneTimeAction state variable.
    /// This function is usually automatically called within the #[storage] macro.
    /// You typically don't need to call this directly when writing smart contracts.
    ///
    /// # Arguments
    ///
    /// * `context` - One of `PrivateContext`/`PublicContext`/`UtilityContext`. The
    ///               Context determines which methods of this struct will be made
    ///               available to the calling smart contract function.
    /// * `storage_slot` - A unique identifier for this state variable within the
    ///                    contract. The permanent note for this OneTimeAction
    ///                    state variable will have this `storage_slot`.
    ///                    Usually, the #[storage] macro will determine an
    ///                    appropriate storage_slot automatically. A smart contract
    ///                    dev shouldn't have to worry about this, as it's managed
    ///                    behind the scenes.
    ///
    /// docs:start:new
    pub fn new(context: Context, storage_slot: Field) -> Self {
        assert(storage_slot != 0, "Storage slot 0 not allowed. Storage slots must start from 1.");
        Self { context, storage_slot }
    }

    /// Returns the state variable associated scoped to the given owner address.
    ///
    /// You can then mark the action as done by calling `do` on it, query
    /// whether the address did the action with `is_done` (utility function),
    /// or assert with `assert_done` (private function).
    ///
    /// # Arguments
    ///
    /// * `owner` - The AztecAddress to which we scope this variable.
    ///
    /// # Returns
    ///
    /// * `OneTimeActionWithOwner` - The original `OneTimeAction` augmented with an `owner` attribute.
    ///         You can then call methods like `.do()`, `.assert_done()`, `.is_done()`, etc. which
    ///         are scoped to the given owner address.
    ///
    /// # Example
    ///
    /// ```noir
    /// // Continue execution only if owner hasn't acted upon this variable before
    /// self.storage.some_one_time_topic.at(owner).do(...);
    /// self.enqueue.some_effect();
    /// ```
    ///
    pub fn at(self, owner: AztecAddress) -> OneTimeActionWithOwner<ACTION, Context> {
        OneTimeActionWithOwner { context: self.context, storage_slot: self.storage_slot, owner }
    }
}

impl<ACTION, Context> OneTimeActionWithOwner<ACTION, Context>
where
    ACTION: Serialize,
{
    /// Computes the nullifier that will be created when the given `action`
    /// is acted upon by the owner (denoted by the app-siloed nullifier secret key `owner_nsk_app`).
    ///
    /// This function is primarily used internally by functions `do`, `assert_done` and
    /// `is_done` to coherently write and read state.
    ///
    /// # Returns
    ///
    /// * `Field` - The nullifier that will be emitted when `owner` acts upon `action`.
    ///
    fn compute_nullifier(self, action: ACTION, owner_nsk_app: Field) -> Field {
        // TODO(F-180): make sure we follow the nullifier convention
        poseidon2_hash_with_separator(
            action.serialize().concat([owner_nsk_app, self.storage_slot]),
            GENERATOR_INDEX__NOTE_HASH,
        )
    }
}

impl<ACTION> OneTimeActionWithOwner<ACTION, &mut PrivateContext>
where
    ACTION: Serialize,
{
    /// Marks `action` as acted upon by `owner`. This function succeeds at most once
    /// for a given `<owner, action>` combination. Any subsequent calls with same
    /// inputs are guaranteed to fail.
    ///
    /// ## Arguments
    ///
    /// * `action` - An instance of a `Serializable` type used to differentiate actions.
    ///     At its simplest, said type could be an empty struct which means this state variable
    ///     can only track one type of action topic. However, arbitrarily richer action structs
    ///     are supported. For example defining a `struct MyAction { id: Field }` would let you
    ///     use this single state variable to track usage along different actions each with
    ///     their own `id`.
    ///
    /// ## Advanced
    ///
    /// The implementation of this function emits a nullifier derived from
    /// the `owner`'s nullifier secret key, a storage slot, and the `action` to be marked.
    ///
    /// Any subsequent attempts at calling this function with the same owner and action
    /// combination are guaranteed by the protocol to fail (since it would result in duplicate
    /// nullifiers), which is why this function provides `at most once execution` semantics.
    pub fn do(self, action: ACTION) {
        let owner_nsk_app = self.context.request_nsk_app(get_public_keys(self.owner).npk_m.hash());
        self.context.push_nullifier(self.compute_nullifier(action, owner_nsk_app));
    }

    /// Asserts that an `action` was acted upon by `owner`.
    ///
    /// ## Arguments
    ///
    /// * `action` - An instance of a `Serializable` type used to differentiate actions.
    ///     At its simplest, said type could be an empty struct which means this state variable
    ///     can only track one type of action topic. However, arbitrarily richer action structs
    ///     are supported. For example defining a `struct MyAction { id: Field }` would let you
    ///     use this single state variable to track usage along different actions each with
    ///     their own `id`.
    ///
    /// ## Advanced
    ///
    /// The implementation of this function computes a nullifier derived from
    /// the `owner`'s nullifier secret key, the state variable's storage slot, and the param `action`.
    ///
    /// It then pushes a request to find the nullifier in private state, including nullifiers emitted
    /// during the current transaction (also known as _transient nullifiers_). This request will
    /// _eventually cause_ the current transaction simulation/proving to fail if the nullifier
    /// is not found, which guarantees any private function using this call will fail unless
    /// `owner` performed the given `action`.
    pub fn assert_done(self, action: ACTION) {
        let owner_nsk_app = self.context.request_nsk_app(get_public_keys(self.owner).npk_m.hash());
        let nullifier = self.compute_nullifier(action, owner_nsk_app);
        self.context.push_nullifier_read_request(nullifier, self.context.this_address())
    }
}

impl<ACTION> OneTimeActionWithOwner<ACTION, UtilityContext>
where
    ACTION: Serialize,
{
    /// Returns whether an `action` was acted upon by `owner`.
    ///
    /// ## Arguments
    ///
    /// * `action` - An instance of a `Serializable` type used to differentiate actions.
    ///     At its simplest, said type could be an empty struct which means this state variable
    ///     can only track one type of action topic. However, arbitrarily richer action structs
    ///     are supported. For example defining a `struct MyAction { id: Field }` would let you
    ///     use this single state variable to track usage along different actions each with
    ///     their own `id`.
    ///
    /// ## Returns
    ///
    /// * `true` - If the param `action` was acted upon by `owner`.
    /// * `false` - Otherwise.
    ///
    /// ## Advanced
    ///
    /// The implementation of this function computes a nullifier derived from
    /// the `owner`'s nullifier secret key, the state variable's storage slot, and the param `action`.
    ///
    /// It then requests PXE to find the nullifier in private state, including nullifiers emitted
    /// during the current transaction (also known as _transient nullifiers_).
    pub unconstrained fn is_done(self, action: ACTION) -> bool {
        let owner_nsk_app = get_nsk_app(get_public_keys(self.owner).npk_m.hash());
        check_nullifier_exists(self.compute_nullifier(action, owner_nsk_app))
    }
}
