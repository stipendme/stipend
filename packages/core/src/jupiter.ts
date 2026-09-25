import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { isSurfnet, surfnet } from "./fork.js";

const BASE = process.env.JUPITER_API_URL ?? "https://lite-api.jup.ag";
const headers: Record<string, string> = process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {};

export interface JupQuote {
  inputMint: string; outputMint: string; inAmount: string; outAmount: string; otherAmountThreshold: string;
  priceImpactPct: string; slippageBps: number; routePlan: unknown[]; [k: string]: unknown;
}

export async function getQuote(inputMint: PublicKey | string, outputMint: PublicKey | string, amount: bigint, slippageBps = 50): Promise<JupQuote> {
  const url = `${BASE}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`jupiter quote ${r.status}: ${await r.text()}`);
  return (await r.json()) as JupQuote;
}

export interface SwapResult { signature: string; inAmount: bigint; outAmount: bigint; quote: JupQuote }

export async function swap(connection: Connection, wallet: Keypair, inputMint: PublicKey | string, outputMint: PublicKey | string, amount: bigint, slippageBps = 50, opts: { outputTokenProgram?: PublicKey } = {}): Promise<SwapResult> {
  const quote = await getQuote(inputMint, outputMint, amount, slippageBps);
  if (await isSurfnet(connection)) {
    // A Jupiter transaction is built against live mainnet state and cannot land on a fork. Stand in for the fill:
    // debit the SOL and credit the quoted output to the wallet's ATA via cheatcodes. Everything before and after is real.
    if (String(inputMint) !== SOL_MINT) throw new Error("fork swap only supports SOL input");
    const outMint = new PublicKey(String(outputMint));
    const prog = opts.outputTokenProgram;
    const ataAddr = getAssociatedTokenAddressSync(outMint, wallet.publicKey, false, prog);
    let have = 0n;
    try { have = BigInt((await connection.getTokenAccountBalance(ataAddr)).value.amount); } catch { have = 0n; }
    await surfnet.setTokenAccount(connection, wallet.publicKey, outMint, have + BigInt(quote.outAmount), prog);
    await surfnet.addLamports(connection, wallet.publicKey, -amount);
    return { signature: `surfnet-fill-${Date.now()}`, inAmount: BigInt(quote.inAmount), outAmount: BigInt(quote.outAmount), quote };
  }
  const r = await fetch(`${BASE}/swap/v1/swap`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      quoteResponse: quote, userPublicKey: wallet.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
      dynamicSlippage: false, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 2_000_000, priorityLevel: "high" } },
    }),
  });
  if (!r.ok) throw new Error(`jupiter swap ${r.status}: ${await r.text()}`);
  const { swapTransaction, lastValidBlockHeight } = (await r.json()) as { swapTransaction: string; lastValidBlockHeight: number };
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([wallet]);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, blockhash: bh.blockhash, lastValidBlockHeight: lastValidBlockHeight ?? bh.lastValidBlockHeight }, "confirmed");
  return { signature, inAmount: BigInt(quote.inAmount), outAmount: BigInt(quote.outAmount), quote };
}

/** USD prices keyed by mint (Jupiter price v3). Missing mints are absent. */
export async function getPrices(mints: (PublicKey | string)[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  const r = await fetch(`${BASE}/price/v3?ids=${mints.map(String).join(",")}`, { headers });
  if (!r.ok) throw new Error(`jupiter price ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as Record<string, { usdPrice?: number; price?: string | number }>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(j ?? {})) {
    const p = v?.usdPrice ?? (v?.price !== undefined ? Number(v.price) : undefined);
    if (p !== undefined && Number.isFinite(p)) out[k] = p;
  }
  return out;
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";
