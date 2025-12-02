pub trait OwnedStateVariable<Context> {
    /// Initializes a new owned state variable.
    ///
    /// This function is automatically called within the #[storage] macro.
    ///
    /// # Arguments
    ///
    /// * `context` - One of `PublicContext`/`PrivateContext`/`UtilityContext`. The Context determines which methods of
    ///               the state variable will be made available to the calling smart contract function.
    /// * `storage_slot` - A unique identifier for the state variable within the contract. Usually, the #[storage] macro
    ///                    will determine an appropriate storage_slot automatically. A smart contract dev shouldn't have
    ///                    to worry about this, as it's managed behind the scenes.
    /// * `owner` - The owner of the state variable.
    ///
    fn new(context: Context, storage_slot: Field, owner: AztecAddress) -> Self;
}
