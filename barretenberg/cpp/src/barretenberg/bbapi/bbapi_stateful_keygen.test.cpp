#include "barretenberg/bbapi/bbapi_ultra_honk.hpp"
#include "barretenberg/chonk/acir_bincode_mocks.hpp"
#include "barretenberg/common/serialize.hpp"
#include "barretenberg/dsl/acir_format/acir_format.hpp"
#include <gtest/gtest.h>

namespace bb::bbapi {

class StatefulKeygenTest : public ::testing::Test {
  protected:
    static void SetUpTestSuite() { bb::srs::init_file_crs_factory(bb::srs::bb_crs_path()); }
};

/**
 * @brief Test AcirGetProvingKey command
 * @details Verifies that we can generate a proving key from circuit bytecode
 */
TEST_F(StatefulKeygenTest, AcirGetProvingKey)
{
    auto [bytecode, _witness] = acir_bincode_mocks::create_simple_circuit_bytecode();

    bbapi::ProofSystemSettings settings{ .ipa_accumulation = false,
                                         .oracle_hash_type = "poseidon2",
                                         .disable_zk = true }; // UltraFlavor

    // Generate proving key
    auto pk_response =
        AcirGetProvingKey{ .circuit = { .name = "test_circuit", .bytecode = bytecode }, .settings = settings }
            .execute();

    // Verify proving key was generated
    EXPECT_FALSE(pk_response.proving_key.empty()) << "Proving key should not be empty";
    EXPECT_GT(pk_response.proving_key.size(), 100) << "Proving key should be reasonably sized";
}

/**
 * @brief Test AcirProveWithPk command
 * @details Verifies that we can prove using a pre-computed proving key
 */
TEST_F(StatefulKeygenTest, AcirProveWithPk)
{
    auto [bytecode, witness] = acir_bincode_mocks::create_simple_circuit_bytecode();

    bbapi::ProofSystemSettings settings{ .ipa_accumulation = false,
                                         .oracle_hash_type = "poseidon2",
                                         .disable_zk = true }; // UltraFlavor

    // Step 1: Generate proving key
    auto pk_response =
        AcirGetProvingKey{ .circuit = { .name = "test_circuit", .bytecode = bytecode }, .settings = settings }
            .execute();

    // Step 2: Prove with pre-computed key
    auto prove_response = AcirProveWithPk{ .circuit = { .name = "test_circuit", .bytecode = bytecode },
                                           .witness = witness,
                                           .proving_key = pk_response.proving_key,
                                           .settings = settings }
                              .execute();

    // Verify proof was generated
    EXPECT_FALSE(prove_response.proof.empty()) << "Proof should not be empty";
    EXPECT_FALSE(prove_response.public_inputs.empty()) << "Public inputs should not be empty";
}

/**
 * @brief Test stateful workflow: Generate key once, prove multiple times
 * @details This is the key use case for stateful keygen - reusing the proving key
 */
TEST_F(StatefulKeygenTest, MultipleProofsWithSameKey)
{
    auto [bytecode, witness1] = acir_bincode_mocks::create_simple_circuit_bytecode();
    auto [_bytecode2, witness2] = acir_bincode_mocks::create_simple_circuit_bytecode(2); // Different witness

    bbapi::ProofSystemSettings settings{ .ipa_accumulation = false,
                                         .oracle_hash_type = "poseidon2",
                                         .disable_zk = true };

    // Generate proving key ONCE
    auto pk_response =
        AcirGetProvingKey{ .circuit = { .name = "test_circuit", .bytecode = bytecode }, .settings = settings }
            .execute();

    // Prove MULTIPLE times with different witnesses
    auto proof1 = AcirProveWithPk{ .circuit = { .name = "test_circuit", .bytecode = bytecode },
                                   .witness = witness1,
                                   .proving_key = pk_response.proving_key,
                                   .settings = settings }
                      .execute();

    auto proof2 = AcirProveWithPk{ .circuit = { .name = "test_circuit", .bytecode = bytecode },
                                   .witness = witness2,
                                   .proving_key = pk_response.proving_key,
                                   .settings = settings }
                      .execute();

    // Both proofs should be valid but different (different witnesses)
    EXPECT_FALSE(proof1.proof.empty());
    EXPECT_FALSE(proof2.proof.empty());
    // Proofs should differ because witnesses differ
    EXPECT_NE(proof1.proof, proof2.proof) << "Different witnesses should produce different proofs";
}

/**
 * @brief Test that stateful keygen produces same proof as one-shot proving
 * @details Verifies correctness by comparing against CircuitProve
 */
TEST_F(StatefulKeygenTest, EquivalenceWithCircuitProve)
{
    auto [bytecode, witness] = acir_bincode_mocks::create_simple_circuit_bytecode();

    bbapi::ProofSystemSettings settings{ .ipa_accumulation = false,
                                         .oracle_hash_type = "poseidon2",
                                         .disable_zk = true };

    // Method 1: Stateful (get key + prove with key)
    auto pk_response =
        AcirGetProvingKey{ .circuit = { .name = "test_circuit", .bytecode = bytecode }, .settings = settings }
            .execute();

    auto stateful_proof = AcirProveWithPk{ .circuit = { .name = "test_circuit", .bytecode = bytecode },
                                           .witness = witness,
                                           .proving_key = pk_response.proving_key,
                                           .settings = settings }
                              .execute();

    // Method 2: One-shot (CircuitProve)
    auto vk_response =
        CircuitComputeVk{ .circuit = { .name = "test_circuit", .bytecode = bytecode }, .settings = settings }.execute();

    auto oneshot_proof = CircuitProve{ .circuit = { .name = "test_circuit",
                                                    .bytecode = bytecode,
                                                    .verification_key = vk_response.bytes },
                                       .witness = witness,
                                       .settings = settings }
                             .execute();

    // Both methods should produce valid proofs with same public inputs
    EXPECT_EQ(stateful_proof.public_inputs, oneshot_proof.public_inputs)
        << "Stateful and one-shot should produce same public inputs";

    // Both proofs should verify successfully
    auto verify_stateful = CircuitVerify{ .verification_key = vk_response.bytes,
                                          .public_inputs = stateful_proof.public_inputs,
                                          .proof = stateful_proof.proof,
                                          .settings = settings }
                               .execute();

    auto verify_oneshot = CircuitVerify{ .verification_key = vk_response.bytes,
                                         .public_inputs = oneshot_proof.public_inputs,
                                         .proof = oneshot_proof.proof,
                                         .settings = settings }
                              .execute();

    EXPECT_TRUE(verify_stateful.verified) << "Stateful proof should verify";
    EXPECT_TRUE(verify_oneshot.verified) << "One-shot proof should verify";
}

} // namespace bb::bbapi
