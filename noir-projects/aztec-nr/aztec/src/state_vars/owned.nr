use crate::state_vars::owned_state_variable::OwnedStateVariable;
use crate::state_vars::state_variable::StateVariable;
use protocol_types::address::AztecAddress;

pub struct Owned<V, Context> {
    pub context: Context,
    storage_slot: Field,
}

impl<V, Context> StateVariable<1, Context> for Owned<V, Context> {
    fn get_storage_slot(self) -> Field {
        self.storage_slot
    }

    fn new(context: Context, storage_slot: Field) -> Self {
        assert(storage_slot != 0, "Storage slot 0 not allowed. Storage slots must start from 1.");
        Owned { context, storage_slot }
    }
}

impl<V, Context> Owned<V, Context> {
    pub fn at(self, owner: AztecAddress) -> V
    where
        V: OwnedStateVariable<Context>,
    {
        V::new(self.context, self.storage_slot, owner)
    }
}
