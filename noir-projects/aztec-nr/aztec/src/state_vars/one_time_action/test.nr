use crate::{
    context::{private_context::PrivateContext, UtilityContext},
    oracle::random::random,
    state_vars::one_time_action::OneTimeAction,
};
use crate::test::{helpers::test_environment::TestEnvironment, mocks::mock_struct::MockStruct};
use dep::protocol_types::{address::AztecAddress, traits::FromField};

global STORAGE_SLOT: Field = 17;

unconstrained fn in_private(
    context: &mut PrivateContext,
) -> OneTimeAction<MockStruct, &mut PrivateContext> {
    OneTimeAction::new(context, STORAGE_SLOT)
}

unconstrained fn in_utility(
    context: UtilityContext,
    storage_slot: Field,
) -> OneTimeAction<MockStruct, UtilityContext> {
    OneTimeAction::new(context, storage_slot)
}

unconstrained fn expect_done_to_be(
    done: bool,
    env: TestEnvironment,
    storage_slot: Field,
    action: MockStruct,
    owner: AztecAddress,
) {
    env.utility_context(|context| {
        let state_var = in_utility(context, storage_slot);

        assert(state_var.at(owner).is_done(action) == done);
    });
}

unconstrained fn expect_not_done(
    env: TestEnvironment,
    storage_slot: Field,
    action: MockStruct,
    owner: AztecAddress,
) {
    expect_done_to_be(false, env, storage_slot, action, owner)
}

unconstrained fn expect_done(
    env: TestEnvironment,
    storage_slot: Field,
    action: MockStruct,
    owner: AztecAddress,
) {
    expect_done_to_be(true, env, storage_slot, action, owner)
}

#[test(should_fail_with = "Duplicate siloed nullifier")]
unconstrained fn do_action_twice_same_tx() {
    let mut env = TestEnvironment::new();

    let owner = env.create_light_account();
    let action = MockStruct::new(1, 2);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner).do(action);
        state_var.at(owner).do(action);
    });
}

#[test]
unconstrained fn is_done_when_it_was_not_done() {
    let mut env = TestEnvironment::new();
    let owner = env.create_light_account();

    let action = MockStruct::new(1, 2);
    expect_not_done(env, STORAGE_SLOT, action, owner);
}

#[test(should_fail_with = "already present")]
unconstrained fn do_action_twice_separate_tx() {
    let mut env = TestEnvironment::new();

    let owner = env.create_light_account();
    let action = MockStruct::new(1, 2);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner).do(action);
    });

    expect_done(env, STORAGE_SLOT, action, owner);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner).do(action);
    });
}

#[test]
unconstrained fn do_action_twice_different_owner() {
    let mut env = TestEnvironment::new();

    let owner_a = env.create_light_account();
    let owner_b = env.create_light_account();

    let action = MockStruct::new(1, 2);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner_a).do(action);
        state_var.at(owner_b).do(action);
    });

    expect_done(env, STORAGE_SLOT, action, owner_a);
    expect_done(env, STORAGE_SLOT, action, owner_b);
}

#[test]
unconstrained fn do_two_different_actions() {
    let mut env = TestEnvironment::new();

    let owner = env.create_light_account();

    let action_1 = MockStruct::new(1, 2);
    let action_2 = MockStruct::new(3, 4);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner).do(action_1);
        state_var.at(owner).do(action_2);
    });

    expect_done(env, STORAGE_SLOT, action_1, owner);
    expect_done(env, STORAGE_SLOT, action_2, owner);
}

#[test]
unconstrained fn do_two_actions_different_state_vars() {
    let mut env = TestEnvironment::new();

    let owner = env.create_light_account();
    let action = MockStruct::new(1, 2);

    env.private_context(|context| {
        let state_var_a = OneTimeAction::new(context, STORAGE_SLOT);
        let state_var_b = OneTimeAction::new(context, STORAGE_SLOT + 1);

        state_var_a.at(owner).do(action);
        state_var_b.at(owner).do(action);
    });

    expect_done(env, STORAGE_SLOT, action, owner);
    expect_done(env, STORAGE_SLOT + 1, action, owner);
}

#[test(should_fail_with = "No public key registered")]
unconstrained fn do_action_owner_unknown_public_keys() {
    let mut env = TestEnvironment::new();

    let owner = AztecAddress::from_field(random());
    let action = MockStruct::new(1, 2);

    env.private_context(|context| {
        let state_var = in_private(context);

        state_var.at(owner).do(action);
    });
}
