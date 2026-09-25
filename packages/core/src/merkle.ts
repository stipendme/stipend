/**
 * Merkle tree matching solana-foundation/rewards program/src/utils/merkle_utils.rs:
 *   leaf  = keccak(LEAF_PREFIX(0x00) || keccak(claimant(32) || total_amount u64 LE || schedule_bytes))
 *   node  = keccak(min(a,b) || max(a,b))
 *   leaves are sorted by hash before pairing; an odd trailing node is promoted unchanged.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import { getVestingScheduleEncoder, type VestingScheduleArgs } from "@solana/rewards";
import { PublicKey } from "@solana/web3.js";

export const IMMEDIATE: VestingScheduleArgs = { __kind: "Immediate" };
const LEAF_PREFIX = 0;
const encoder = getVestingScheduleEncoder();

function concat(...arrays: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function u64Le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

export function scheduleBytes(schedule: VestingScheduleArgs = IMMEDIATE): Uint8Array {
  return Uint8Array.from(encoder.encode(schedule));
}

export function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  return compareBytes(a, b) <= 0 ? keccak_256(concat(a, b)) : keccak_256(concat(b, a));
}

export function computeLeafHash(claimant: PublicKey | string | Uint8Array, totalAmount: bigint, schedule: VestingScheduleArgs = IMMEDIATE): Uint8Array {
  const claimantBytes = claimant instanceof Uint8Array ? claimant : new PublicKey(claimant).toBytes();
  const inner = keccak_256(concat(claimantBytes, u64Le(totalAmount), scheduleBytes(schedule)));
  return keccak_256(concat(new Uint8Array([LEAF_PREFIX]), inner));
}

export interface MerkleTree {
  root: Uint8Array;
  /** proofs[i] is the proof for leaves[i] (input order) */
  proofs: Uint8Array[][];
}

export function buildMerkleTree(leaves: Uint8Array[]): MerkleTree {
  const proofs: Uint8Array[][] = leaves.map(() => []);
  type Node = { hash: Uint8Array; idx: number[] };
  let level: Node[] = leaves.map((hash, i) => ({ hash, idx: [i] })).sort((a, b) => compareBytes(a.hash, b.hash));
  while (level.length > 1) {
    const next: Node[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i];
      const r = level[i + 1];
      if (!r) { next.push(l); continue; }
      for (const k of l.idx) proofs[k].push(r.hash);
      for (const k of r.idx) proofs[k].push(l.hash);
      next.push({ hash: hashPair(l.hash, r.hash), idx: [...l.idx, ...r.idx] });
    }
    level = next;
  }
  return { root: level[0]?.hash ?? new Uint8Array(32), proofs };
}

export function verifyProof(proof: Uint8Array[], root: Uint8Array, leaf: Uint8Array): boolean {
  let h = leaf;
  for (const sib of proof) h = hashPair(h, sib);
  return compareBytes(h, root) === 0;
}

export const toHex = (b: Uint8Array | number[]) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (s: string) => Uint8Array.from(s.replace(/^0x/, "").match(/.{2}/g)!.map((h) => parseInt(h, 16)));
export const toNumArray = (b: Uint8Array) => Array.from(b);
