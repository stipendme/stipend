/**
 * Turning an epoch's SOL budget into the asset. Three modes, chosen by the cluster:
 *  - jupiter: real swap (mainnet)
 *  - surfnet: quote on mainnet, credit via cheatcodes (Surfpool fork rehearsal)
 *  - testmint: devnet/testnet. Price the fill with mainnet Jupiter prices for SOL and asset.priceMint,
 *    mint that many test-asset units to the worker (the worker is the test mint's authority), and move the
 *    budget SOL to the treasury so the SOL leaves the worker exactly as a real fill would.
 */
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMintToInstruction, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { getNetwork } from "./network.js";
import { swap, getPrices, getQuote, SOL_MINT } from "./jupiter.js";
import { ata, tokenProgramId } from "./token.js";
import type { LstEntry } from "./registry.js";

export type FillMode = "jupiter" | "surfnet" | "testmint";
export interface FillResult { outAmount: bigint; inAmount: bigint; signature: string; mode: FillMode; priceUsd?: number }

export async function fillMode(conn: Connection): Promise<FillMode> {
  const n = await getNetwork(conn);
  if (n === "mainnet-beta") return "jupiter";
  if (n === "surfnet") return "surfnet";
  return "testmint";
}

/** Quote-only, for dry runs and estimates: how much asset this budget buys. */
export async function quoteFill(conn: Connection, lst: LstEntry, budget: bigint): Promise<{ outAmount: bigint; priceUsd?: number; mode: FillMode }> {
  const mode = await fillMode(conn);
  if (mode !== "testmint") {
    const q = await getQuote(SOL_MINT, lst.asset.mint, budget);
    return { outAmount: BigInt(q.outAmount), mode };
  }
  const { outAmount, priceUsd } = await testmintAmount(lst, budget);
  return { outAmount, priceUsd, mode };
}

async function testmintAmount(lst: LstEntry, budget: bigint) {
  const priceMint = lst.asset.priceMint ?? lst.asset.mint;
  const prices = await getPrices([SOL_MINT, priceMint]);
  const solUsd = prices[SOL_MINT], assetUsd = prices[priceMint];
  if (!solUsd || !assetUsd) throw new Error(`testmint fill: missing mainnet price for SOL or ${priceMint}`);
  const usd = (Number(budget) / 1e9) * solUsd;
  const outAmount = BigInt(Math.floor((usd / assetUsd) * 10 ** lst.asset.decimals));
  return { outAmount, priceUsd: assetUsd };
}

export async function fill(conn: Connection, worker: Keypair, lst: LstEntry, budget: bigint, opts: { treasury?: PublicKey; slippageBps?: number } = {}): Promise<FillResult> {
  const mode = await fillMode(conn);
  const prog = tokenProgramId(lst.asset.tokenProgram);
  if (mode !== "testmint") {
    const r = await swap(conn, worker, SOL_MINT, lst.asset.mint, budget, opts.slippageBps ?? 50, { outputTokenProgram: prog });
    return { outAmount: r.outAmount, inAmount: r.inAmount, signature: r.signature, mode };
  }
  const { outAmount, priceUsd } = await testmintAmount(lst, budget);
  const mint = new PublicKey(lst.asset.mint);
  const dest = ata(mint, worker.publicKey, prog);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(worker.publicKey, dest, worker.publicKey, mint, prog),
    createMintToInstruction(mint, dest, worker.publicKey, outAmount, [], prog),
  );
  if (opts.treasury && !opts.treasury.equals(worker.publicKey) && budget > 0n) {
    tx.add(SystemProgram.transfer({ fromPubkey: worker.publicKey, toPubkey: opts.treasury, lamports: budget }));
  }
  tx.feePayer = worker.publicKey;
  const signature = await sendAndConfirmTransaction(conn, tx, [worker], { commitment: "confirmed" });
  return { outAmount, inAmount: budget, signature, mode, priceUsd };
}
