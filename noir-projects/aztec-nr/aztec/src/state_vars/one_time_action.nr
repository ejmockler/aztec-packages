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

pub struct OneTimeAction<ACTION, Context> {
    context: Context,
    storage_slot: Field,
}

impl<ACTION, Context> HasStorageSlot<1> for OneTimeAction<ACTION, Context> {
    fn get_storage_slot(self) -> Field {
        self.storage_slot
    }
}

pub struct OneTimeActionWithOwner<ACTION, Context> {
    context: Context,
    storage_slot: Field,
    owner: AztecAddress,
}

impl<ACTION, Context> OneTimeAction<ACTION, Context> {
    pub fn new(context: Context, storage_slot: Field) -> Self {
        assert(storage_slot != 0, "Storage slot 0 not allowed. Storage slots must start from 1.");
        Self { context, storage_slot }
    }

    pub fn at(self, owner: AztecAddress) -> OneTimeActionWithOwner<ACTION, Context> {
        OneTimeActionWithOwner { context: self.context, storage_slot: self.storage_slot, owner }
    }
}

impl<ACTION, Context> OneTimeActionWithOwner<ACTION, Context>
where
    ACTION: Serialize,
{
    fn compute_nullifier(self, action: ACTION, owner_nsk_app: Field) -> Field {
        // TODO(F-182): make sure we follow the nullifier convention
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
    pub fn do(self, action: ACTION) {
        let owner_nsk_app = self.context.request_nsk_app(get_public_keys(self.owner).npk_m.hash());
        self.context.push_nullifier(self.compute_nullifier(action, owner_nsk_app));
    }

    // TODO: write e2e test to test this with kernel prover machinery
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
    pub unconstrained fn is_done(self, action: ACTION) -> bool {
        let owner_nsk_app = get_nsk_app(get_public_keys(self.owner).npk_m.hash());
        check_nullifier_exists(self.compute_nullifier(action, owner_nsk_app))
    }
}
