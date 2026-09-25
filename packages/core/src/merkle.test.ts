import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMerkleTree, computeLeafHash, hashPair, verifyProof, compareBytes } from "./merkle.js";

// Ported from solana-foundation/rewards program/src/utils/merkle_utils.rs tests
const linear = { __kind: "Linear", startTs: 100n, endTs: 200n } as const;
const c = (n: number) => new Uint8Array(32).fill(n);

test("leaf hash deterministic and input-sensitive", () => {
  assert.deepEqual(computeLeafHash(c(1), 1000n, linear), computeLeafHash(c(1), 1000n, linear));
  assert.notDeepEqual(computeLeafHash(c(1), 1000n, linear), computeLeafHash(c(2), 1000n, linear));
  assert.notDeepEqual(computeLeafHash(c(1), 1000n, linear), computeLeafHash(c(1), 2000n, linear));
  assert.notDeepEqual(computeLeafHash(c(1), 1000n, linear), computeLeafHash(c(1), 1000n, { __kind: "Linear", startTs: 100n, endTs: 300n }));
  assert.notDeepEqual(computeLeafHash(c(1), 1000n), computeLeafHash(c(1), 1000n, linear));
});

test("hash pair commutative", () => {
  assert.deepEqual(hashPair(c(1), c(2)), hashPair(c(2), c(1)));
});

test("single leaf root equals leaf; two leaves verify", () => {
  const l1 = computeLeafHash(c(1), 1000n, linear);
  const l2 = computeLeafHash(c(2), 2000n, linear);
  assert.ok(verifyProof([], l1, l1));
  const root = hashPair(l1, l2);
  assert.ok(verifyProof([l2], root, l1));
  assert.ok(verifyProof([l1], root, l2));
  const t = buildMerkleTree([l1, l2]);
  assert.equal(compareBytes(t.root, root), 0);
});

test("four and five leaves: every proof verifies against the root", () => {
  for (const n of [4, 5, 33]) {
    const leaves = Array.from({ length: n }, (_, i) => computeLeafHash(c(i + 1), BigInt(1000 * (i + 1)), linear));
    const t = buildMerkleTree(leaves);
    leaves.forEach((leaf, i) => assert.ok(verifyProof(t.proofs[i], t.root, leaf), `leaf ${i} of ${n}`));
    assert.ok(!verifyProof(t.proofs[0], t.root, leaves[1] ?? leaves[0]) || n === 1);
  }
});
