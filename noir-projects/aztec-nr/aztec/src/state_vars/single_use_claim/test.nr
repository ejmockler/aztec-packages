use crate::{
    context::{private_context::PrivateContext, UtilityContext},
    oracle::random::random,
    state_vars::single_use_claim::SingleUseClaim,
};
use crate::test::{helpers::test_environment::TestEnvironment, mocks::mock_struct::MockStruct};
use dep::protocol_types::{address::AztecAddress, traits::FromField};

global STORAGE_SLOT: Field = 17;

unconstrained fn in_private(
    context: &mut PrivateContext,
) -> SingleUseClaim<MockStruct, &mut PrivateContext> {
    SingleUseClaim::new(context, STORAGE_SLOT)
}

unconstrained fn in_utility(
    context: UtilityContext,
    storage_slot: Field,
) -> SingleUseClaim<MockStruct, UtilityContext> {
    SingleUseClaim::new(context, storage_slot)
}

unconstrained fn expect_claim_to_exist(
    claim_exists: bool,
    env: TestEnvironment,
    storage_slot: Field,
    claim_id: MockStruct,
    owner: AztecAddress,
) {
    env.utility_context(|context| {
        let state_var = in_utility(context, storage_slot);

        assert(state_var.at(owner).has_claimed(claim_id) == claim_exists);
    });
}

unconstrained fn expect_not_yet_claimed(
    env: TestEnvironment,
    storage_slot: Field,
    claim_id: MockStruct,
    owner: AztecAddress,
) {
    expect_claim_to_exist(false, env, storage_slot, claim_id, owner)
}

unconstrained fn expect_claimed(
    env: TestEnvironment,
    storage_slot: Field,
    claim_id: MockStruct,
    owner: AztecAddress,
) {
    expect_claim_to_exist(true, env, storage_slot, claim_id, owner)
}

#[test(should_fail_with = "Duplicate siloed nullifier")]
unconstrained fn claim_twice_same_tx() {
    let mut env = TestEnvironment::new();

    let owner = env.create_light_account();
    let claim_id = MockStruct::new(1, 2);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner).claim(claim_id);
        state_var.at(owner).claim(claim_id);
    });
}

#[test]
unconstrained fn has_not_yet_claimed() {
    let mut env = TestEnvironment::new();
    let owner = env.create_light_account();

    let claim_id = MockStruct::new(1, 2);
    expect_not_yet_claimed(env, STORAGE_SLOT, claim_id, owner);
}

#[test(should_fail_with = "already present")]
unconstrained fn claim_twice_separate_tx() {
    let mut env = TestEnvironment::new();

    let owner = env.create_light_account();
    let claim_id = MockStruct::new(1, 2);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner).claim(claim_id);
    });

    expect_claimed(env, STORAGE_SLOT, claim_id, owner);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner).claim(claim_id);
    });
}

#[test]
unconstrained fn claim_twice_different_owner() {
    let mut env = TestEnvironment::new();

    let owner_a = env.create_light_account();
    let owner_b = env.create_light_account();

    let claim_id = MockStruct::new(1, 2);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner_a).claim(claim_id);
        state_var.at(owner_b).claim(claim_id);
    });

    expect_claimed(env, STORAGE_SLOT, claim_id, owner_a);
    expect_claimed(env, STORAGE_SLOT, claim_id, owner_b);
}

#[test]
unconstrained fn claim_two_different_claim_ids() {
    let mut env = TestEnvironment::new();

    let owner = env.create_light_account();

    let claim_id_1 = MockStruct::new(1, 2);
    let claim_id_2 = MockStruct::new(3, 4);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner).claim(claim_id_1);
        state_var.at(owner).claim(claim_id_2);
    });

    expect_claimed(env, STORAGE_SLOT, claim_id_1, owner);
    expect_claimed(env, STORAGE_SLOT, claim_id_2, owner);
}

#[test]
unconstrained fn claim_two_claim_ids_different_state_vars() {
    let mut env = TestEnvironment::new();

    let owner = env.create_light_account();
    let claim_id = MockStruct::new(1, 2);

    env.private_context(|context| {
        let state_var_a = SingleUseClaim::new(context, STORAGE_SLOT);
        let state_var_b = SingleUseClaim::new(context, STORAGE_SLOT + 1);

        state_var_a.at(owner).claim(claim_id);
        state_var_b.at(owner).claim(claim_id);
    });

    expect_claimed(env, STORAGE_SLOT, claim_id, owner);
    expect_claimed(env, STORAGE_SLOT + 1, claim_id, owner);
}

#[test(should_fail_with = "No public key registered")]
unconstrained fn claim_owner_unknown_public_keys() {
    let mut env = TestEnvironment::new();

    let owner = AztecAddress::from_field(random());
    let claim_id = MockStruct::new(1, 2);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner).claim(claim_id);
    });
}
