import { Barretenberg } from './index.js';
import { BackendType } from '../bb_backends/index.js';
import { CircuitInput, ProofSystemSettings } from '../cbind/generated/api_types.js';

describe('stateful keygen', () => {
    let api: Barretenberg;

    beforeAll(async () => {
        // Force Wasm backend to verify WASM integration specifically
        api = await Barretenberg.new({ threads: 1, backend: BackendType.Wasm });
    });

    afterAll(async () => {
        await api.destroy();
    });

    // Valid bytecode generated from C++ AcirFormatTests.GenerateValidBytecode
    // Circuit: w1 + w2 - w3 = 0
    const bytecodeHex = "010000000000000004000000000000006d61696e040000000100000000000000000000000000000000000000030000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000001010000002000000000000000000000000000000000000000000000000000000000000000000000000000000102000000200000000000000030644e72e131a029b85045b68181585d2833e84879b9709143e1f593f00000000300000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    const bytecode = Buffer.from(bytecodeHex, 'hex');

    const settings: ProofSystemSettings = {
        ipaAccumulation: false,
        oracleHashType: 'poseidon2',
        disableZk: true,
        optimizedSolidityVerifier: false,
    };

    function serializeWitnessStack(witness: Map<number, string>): Uint8Array {
        const sortedKeys = Array.from(witness.keys()).sort((a, b) => a - b);

        // Calculate buffer size
        // stack_len (8) + item_index (4) + map_len (8)
        let size = 8 + 4 + 8;
        for (let i = 0; i < sortedKeys.length; i++) {
            // key (4) + val_len (8) + val (32)
            size += 4 + 8 + 32;
        }

        const buffer = Buffer.alloc(size);
        let offset = 0;

        // WitnessStack.stack length = 1
        buffer.writeBigUInt64LE(1n, offset);
        offset += 8;

        // StackItem.index = 0
        buffer.writeUInt32LE(0, offset);
        offset += 4;

        // WitnessMap length
        buffer.writeBigUInt64LE(BigInt(sortedKeys.length), offset);
        offset += 8;

        for (let i = 0; i < sortedKeys.length; i++) {
            const key = sortedKeys[i];
            const value = witness.get(key)!;
            const valueBuffer = Buffer.from(value.replace(/^0x/, ''), 'hex');
            const paddedValue = Buffer.concat([Buffer.alloc(32 - valueBuffer.length), valueBuffer]);

            // Witness.value (key)
            buffer.writeUInt32LE(key, offset);
            offset += 4;

            // vector<uint8_t> length = 32
            buffer.writeBigUInt64LE(32n, offset);
            offset += 8;

            // vector<uint8_t> data
            paddedValue.copy(buffer, offset);
            offset += 32;
        }

        return buffer;
    }

    it('should generate proving key and prove with it', async () => {
        const circuit: CircuitInput = {
            name: 'test_circuit',
            bytecode: bytecode,
            verificationKey: new Uint8Array(),
        };

        // Step 1: Generate proving key
        const provingKeyResult = await api.acirGetProvingKey({ circuit, settings });
        expect(provingKeyResult.provingKey.length).toBeGreaterThan(0);

        // Step 2: Prove with witness 1
        const initialWitness = new Map<number, string>();
        initialWitness.set(1, "0x0000000000000000000000000000000000000000000000000000000000000001");
        initialWitness.set(2, "0x0000000000000000000000000000000000000000000000000000000000000002");
        initialWitness.set(3, "0x0000000000000000000000000000000000000000000000000000000000000003");

        const witness1 = serializeWitnessStack(initialWitness);

        const proof1 = await api.acirProveWithPk({
            circuit,
            witness: witness1,
            provingKey: provingKeyResult.provingKey,
            settings
        });

        expect(proof1.proof.length).toBeGreaterThan(0);
        expect(proof1.publicInputs.length).toBeGreaterThan(0);

        // Step 3: Prove with witness 2 (reuse key)
        const witnessMap2 = new Map<number, string>();
        witnessMap2.set(1, "0x0000000000000000000000000000000000000000000000000000000000000004");
        witnessMap2.set(2, "0x0000000000000000000000000000000000000000000000000000000000000005");
        witnessMap2.set(3, "0x0000000000000000000000000000000000000000000000000000000000000009");

        const witness2 = serializeWitnessStack(witnessMap2);

        const proof2 = await api.acirProveWithPk({
            circuit,
            witness: witness2,
            provingKey: provingKeyResult.provingKey,
            settings
        });

        expect(proof2.proof.length).toBeGreaterThan(0);
        expect(proof2.publicInputs.length).toBeGreaterThan(0);
    }, 60000); // 60s timeout
});
