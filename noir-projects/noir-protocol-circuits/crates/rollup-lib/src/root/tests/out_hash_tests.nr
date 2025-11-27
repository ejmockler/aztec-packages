use super::TestBuilder;
use types::{
    constants::{EMPTY_EPOCH_OUT_HASH, OUT_HASH_TREE_HEIGHT},
    merkle_tree::compute_empty_sha_tree_root,
};

#[test(should_fail_with = "Epoch did not start with empty out hash tree root")]
fn non_empty_out_hash_root() {
    let mut builder = TestBuilder::default();

    // Tweak the root of the previous_out_hash in the left rollup.
    builder.left_rollup.previous_out_hash.root += 1;

    builder.execute_and_fail();
}

#[test(should_fail_with = "Epoch did not start with zero out hash tree index")]
fn non_zero_next_available_leaf_index() {
    let mut builder = TestBuilder::default();

    // Tweak the next_available_leaf_index in the left rollup.
    builder.left_rollup.previous_out_hash.next_available_leaf_index = 1;

    builder.execute_and_fail();
}

#[test]
fn correct_empty_epoch_out_hash() {
    let empty_root = compute_empty_sha_tree_root::<OUT_HASH_TREE_HEIGHT>();
    assert_eq(empty_root, EMPTY_EPOCH_OUT_HASH);
}
