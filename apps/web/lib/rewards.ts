import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { ClaimableRow, ClosedClaimRow } from "./types";

// TODO-swap: @stipend/core buildClaimMerkleIx / buildCloseMerkleClaimIx. Hand-encoded here so the
// browser bundle does not need @solana/kit. Layouts verified against the Codama client in
// packages/rewards-client (ClaimMerkle = 6, CloseMerkleClaim = 7, event authority seed "event_authority").

export const REWARDS_PROGRAM_ID = new PublicKey("REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi");

export function tokenProgramFor(kind: "spl-token" | "token-2022"): PublicKey {
  return kind === "token-2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

export function eventAuthorityPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("event_authority")], REWARDS_PROGRAM_ID)[0];
}

export function merkleClaimPda(distribution: PublicKey, claimant: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_claim"), distribution.toBuffer(), claimant.toBuffer()],
    REWARDS_PROGRAM_ID,
  );
}

export function revocationPda(distribution: PublicKey, claimant: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("revocation"), distribution.toBuffer(), claimant.toBuffer()],
    REWARDS_PROGRAM_ID,
  )[0];
}

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

/** Instructions to claim one leaf in full: creates the claimant ATA if needed, then ClaimMerkle. */
export function buildClaimMerkleIxs(row: ClaimableRow, claimant: PublicKey): TransactionInstruction[] {
  const distribution = new PublicKey(row.distribution);
  const mint = new PublicKey(row.assetMint);
  const tokenProgram = tokenProgramFor(row.tokenProgram);
  const [claimAccount, claimBump] = merkleClaimPda(distribution, claimant);
  const vault = getAssociatedTokenAddressSync(mint, distribution, true, tokenProgram);
  const claimantAta = getAssociatedTokenAddressSync(mint, claimant, false, tokenProgram);

  const proof = row.proof;
  const data = Buffer.concat([
    Buffer.from([6, claimBump]),
    u64le(BigInt(row.totalAmount)),
    u64le(0n), // amount 0 = claim everything vested
    Buffer.from([0]), // VestingSchedule::Immediate
    (() => {
      const len = Buffer.alloc(4);
      len.writeUInt32LE(proof.length);
      return len;
    })(),
    ...proof.map((node) => Buffer.from(node)),
  ]);

  const claim = new TransactionInstruction({
    programId: REWARDS_PROGRAM_ID,
    keys: [
      { pubkey: claimant, isSigner: true, isWritable: true }, // payer
      { pubkey: claimant, isSigner: true, isWritable: false }, // claimant
      { pubkey: distribution, isSigner: false, isWritable: true },
      { pubkey: claimAccount, isSigner: false, isWritable: true },
      { pubkey: revocationPda(distribution, claimant), isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: claimantAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: eventAuthorityPda(), isSigner: false, isWritable: false },
      { pubkey: REWARDS_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  return [
    createAssociatedTokenAccountIdempotentInstruction(claimant, claimantAta, claimant, mint, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID),
    claim,
  ];
}

/** CloseMerkleClaim: refunds the claim PDA rent once the distribution has been closed by the worker. */
export function buildCloseMerkleClaimIx(row: ClosedClaimRow, claimant: PublicKey): TransactionInstruction {
  const distribution = new PublicKey(row.distribution);
  const [claimAccount] = merkleClaimPda(distribution, claimant);
  return new TransactionInstruction({
    programId: REWARDS_PROGRAM_ID,
    keys: [
      { pubkey: claimant, isSigner: true, isWritable: true },
      { pubkey: distribution, isSigner: false, isWritable: false },
      { pubkey: claimAccount, isSigner: false, isWritable: true },
      { pubkey: eventAuthorityPda(), isSigner: false, isWritable: false },
      { pubkey: REWARDS_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([7]),
  });
}
