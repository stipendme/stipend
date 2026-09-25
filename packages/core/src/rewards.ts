/**
 * Solana Foundation rewards program, merkle mode. Worker side uses @solana/kit signers; web side gets web3.js v1
 * instructions converted from the generated kit instructions so wallet-adapter can sign them.
 */
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  AccountRole, address, createNoopSigner, generateKeyPairSigner, getProgramDerivedAddress, getAddressEncoder, getUtf8Encoder,
  pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions,
  signTransactionMessageWithSigners, sendAndConfirmTransactionFactory, getSignatureFromTransaction,
  type Address, type Instruction, type KeyPairSigner, type Rpc, type SolanaRpcApi, type RpcSubscriptions, type SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import {
  REWARDS_PROGRAM_PROGRAM_ADDRESS, getCreateMerkleDistributionInstruction, getClaimMerkleInstruction, getCloseMerkleClaimInstruction, getCloseMerkleDistributionInstruction,
  getMerkleDistributionDecoder, getMerkleClaimDecoder, type MerkleDistribution, type MerkleClaim,
} from "@solana/rewards";
import { ata } from "./token.js";
import { IMMEDIATE, toNumArray } from "./merkle.js";

export const REWARDS_PROGRAM_ID = new PublicKey(REWARDS_PROGRAM_PROGRAM_ADDRESS);
const enc = getAddressEncoder();
const utf8 = getUtf8Encoder();
const A = (k: PublicKey | string) => address(k.toString());

export async function findDistributionPda(mint: PublicKey | string, authority: PublicKey | string, seeds: PublicKey | string): Promise<[PublicKey, number]> {
  const [pda, bump] = await getProgramDerivedAddress({ programAddress: REWARDS_PROGRAM_PROGRAM_ADDRESS, seeds: [utf8.encode("merkle_distribution"), enc.encode(A(mint)), enc.encode(A(authority)), enc.encode(A(seeds))] });
  return [new PublicKey(pda), bump];
}
export async function findClaimPda(distribution: PublicKey | string, claimant: PublicKey | string): Promise<[PublicKey, number]> {
  const [pda, bump] = await getProgramDerivedAddress({ programAddress: REWARDS_PROGRAM_PROGRAM_ADDRESS, seeds: [utf8.encode("merkle_claim"), enc.encode(A(distribution)), enc.encode(A(claimant))] });
  return [new PublicKey(pda), bump];
}
export async function findRevocationPda(distribution: PublicKey | string, claimant: PublicKey | string): Promise<[PublicKey, number]> {
  const [pda, bump] = await getProgramDerivedAddress({ programAddress: REWARDS_PROGRAM_PROGRAM_ADDRESS, seeds: [utf8.encode("revocation"), enc.encode(A(distribution)), enc.encode(A(claimant))] });
  return [new PublicKey(pda), bump];
}
/** Program source uses b"event_authority" (the IDL doc comment saying __event_authority is stale). */
export async function findEventAuthorityPda(): Promise<[PublicKey, number]> {
  const [pda, bump] = await getProgramDerivedAddress({ programAddress: REWARDS_PROGRAM_PROGRAM_ADDRESS, seeds: [utf8.encode("event_authority")] });
  return [new PublicKey(pda), bump];
}

export function kitToWeb3(ix: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((a) => ({
      pubkey: new PublicKey(a.address),
      isSigner: a.role === AccountRole.READONLY_SIGNER || a.role === AccountRole.WRITABLE_SIGNER,
      isWritable: a.role === AccountRole.WRITABLE || a.role === AccountRole.WRITABLE_SIGNER,
    })),
    data: Buffer.from(ix.data ?? new Uint8Array()),
  });
}

export interface ClaimParams {
  claimant: PublicKey; distribution: PublicKey; mint: PublicKey; tokenProgram: PublicKey; totalAmount: bigint; proof: (number[] | Uint8Array)[];
  /** amount to claim now; 0 = everything vested */
  amount?: bigint;
}

/** ClaimMerkle for the web: caller must also create the claimant's ATA (idempotent) in the same tx if missing. */
export async function buildClaimMerkleIx(p: ClaimParams): Promise<TransactionInstruction> {
  const [claimAccount, claimBump] = await findClaimPda(p.distribution, p.claimant);
  const [revocationMarker] = await findRevocationPda(p.distribution, p.claimant);
  const [eventAuthority] = await findEventAuthorityPda();
  const signer = createNoopSigner(A(p.claimant));
  const ix = getClaimMerkleInstruction({
    payer: signer, claimant: signer, distribution: A(p.distribution), claimAccount: A(claimAccount), revocationMarker: A(revocationMarker), mint: A(p.mint),
    distributionVault: A(ata(p.mint, p.distribution, p.tokenProgram)), claimantTokenAccount: A(ata(p.mint, p.claimant, p.tokenProgram)), tokenProgram: A(p.tokenProgram),
    eventAuthority: A(eventAuthority), claimBump, totalAmount: p.totalAmount, amount: p.amount ?? 0n, schedule: IMMEDIATE, proof: p.proof.map((x) => Array.from(x)),
  });
  return kitToWeb3(ix);
}

/** CloseMerkleClaim (rent refund to claimant); only valid once the distribution is closed. */
export async function buildCloseMerkleClaimIx(claimant: PublicKey, distribution: PublicKey): Promise<TransactionInstruction> {
  const [claimAccount] = await findClaimPda(distribution, claimant);
  const [eventAuthority] = await findEventAuthorityPda();
  const ix = getCloseMerkleClaimInstruction({ claimant: createNoopSigner(A(claimant)), distribution: A(distribution), claimAccount: A(claimAccount), eventAuthority: A(eventAuthority) });
  return kitToWeb3(ix);
}

export type KitCtx = { rpc: Rpc<SolanaRpcApi>; rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi> };

async function sendKit(ctx: KitCtx, signer: KeyPairSigner, ixs: Instruction[]): Promise<string> {
  const { value: bh } = await ctx.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const signed = await signTransactionMessageWithSigners(msg);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sendAndConfirmTransactionFactory(ctx)(signed as any, { commitment: "confirmed" });
  return getSignatureFromTransaction(signed);
}

export interface CreatedDistribution { distribution: PublicKey; seeds: PublicKey; bump: number; signature: string; vault: PublicKey }

/** Worker: create + fund a merkle distribution from the authority's ATA. seeds is a fresh signer generated here. */
export async function createMerkleDistribution(ctx: KitCtx, authority: KeyPairSigner, p: { mint: PublicKey; tokenProgram: PublicKey; root: Uint8Array; totalAmount: bigint; clawbackTs: number }): Promise<CreatedDistribution> {
  const seeds = await generateKeyPairSigner();
  const authorityPk = new PublicKey(authority.address);
  const [distribution, bump] = await findDistributionPda(p.mint, authorityPk, new PublicKey(seeds.address));
  const [eventAuthority] = await findEventAuthorityPda();
  const vault = ata(p.mint, distribution, p.tokenProgram);
  const ix = getCreateMerkleDistributionInstruction({
    payer: authority, authority, seeds, distribution: A(distribution), mint: A(p.mint), distributionVault: A(vault), authorityTokenAccount: A(ata(p.mint, authorityPk, p.tokenProgram)),
    tokenProgram: A(p.tokenProgram), eventAuthority: A(eventAuthority), bump, revocable: 0, amount: p.totalAmount, merkleRoot: toNumArray(p.root), totalAmount: p.totalAmount, clawbackTs: BigInt(p.clawbackTs),
  });
  const signature = await sendKit(ctx, authority, [ix]);
  return { distribution, seeds: new PublicKey(seeds.address), bump, signature, vault };
}

/** Worker: close a distribution after clawback_ts; unclaimed tokens return to the authority's ATA. */
export async function closeMerkleDistribution(ctx: KitCtx, authority: KeyPairSigner, p: { distribution: PublicKey; mint: PublicKey; tokenProgram: PublicKey }): Promise<string> {
  const authorityPk = new PublicKey(authority.address);
  const [eventAuthority] = await findEventAuthorityPda();
  const ix = getCloseMerkleDistributionInstruction({
    authority, distribution: A(p.distribution), mint: A(p.mint), distributionVault: A(ata(p.mint, p.distribution, p.tokenProgram)), authorityTokenAccount: A(ata(p.mint, authorityPk, p.tokenProgram)),
    tokenProgram: A(p.tokenProgram), eventAuthority: A(eventAuthority),
  });
  return sendKit(ctx, authority, [ix]);
}

export type DistributionState = { kind: "open"; data: MerkleDistribution } | { kind: "closed" } | { kind: "missing" };

export async function fetchDistribution(connection: Connection, distribution: PublicKey): Promise<DistributionState> {
  const info = await connection.getAccountInfo(distribution, "confirmed");
  if (!info) return { kind: "missing" };
  if (!info.owner.equals(REWARDS_PROGRAM_ID)) return { kind: "closed" };
  if (info.data.length < 162) return { kind: "closed" }; // resized to MerkleDistributionClosed marker
  return { kind: "open", data: getMerkleDistributionDecoder().decode(info.data) };
}

/** Claimed amounts for a set of claimants under one distribution (claim PDAs are not indexable, so derive them). */
export async function fetchClaims(connection: Connection, distribution: PublicKey, claimants: string[]): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const pdas = await Promise.all(claimants.map((c) => findClaimPda(distribution, c).then(([p]) => p)));
  for (let i = 0; i < pdas.length; i += 100) {
    const infos = await connection.getMultipleAccountsInfo(pdas.slice(i, i + 100), "confirmed");
    infos.forEach((info, j) => {
      if (!info || !info.owner.equals(REWARDS_PROGRAM_ID) || info.data.length < 18) return;
      const c = getMerkleClaimDecoder().decode(info.data) as MerkleClaim;
      out.set(claimants[i + j], c.claimedAmount);
    });
  }
  return out;
}

export type { Address };
