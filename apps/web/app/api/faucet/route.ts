import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { readFileSync, existsSync } from "node:fs";
import { getNetwork } from "@stipend/core";
import { openDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AIRDROP_SOL = 1;
const TRANSFER_SOL = 2;
const COOLDOWN_S = 6 * 3600;
const ipHits = new Map<string, number[]>();

function faucetKey(): Keypair | null {
  const p = process.env.STIPEND_FAUCET_KEY ?? "";
  if (!p || !existsSync(p)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

export async function POST(req: Request) {
  const conn = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const net = await getNetwork(conn);
  if (net === "mainnet-beta") return NextResponse.json({ error: "faucet is only available on devnet/testnet" }, { status: 400 });
  let wallet: PublicKey;
  try { wallet = new PublicKey(String(((await req.json()) as { wallet?: string }).wallet ?? "")); } catch { return NextResponse.json({ error: "wallet is required" }, { status: 400 }); }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const nowS = Math.floor(Date.now() / 1000);
  const hits = (ipHits.get(ip) ?? []).filter((t) => nowS - t < 3600);
  if (hits.length >= 10) return NextResponse.json({ error: "too many requests from this address, try later" }, { status: 429 });
  hits.push(nowS); ipHits.set(ip, hits);

  const db = openDb();
  db?.exec("CREATE TABLE IF NOT EXISTS faucet_claims (wallet TEXT NOT NULL, ts INTEGER NOT NULL, lamports TEXT NOT NULL, method TEXT NOT NULL, signature TEXT)");
  const last = db?.prepare("SELECT ts FROM faucet_claims WHERE wallet = ? ORDER BY ts DESC LIMIT 1").get(wallet.toBase58()) as { ts: number } | undefined;
  if (last && nowS - last.ts < COOLDOWN_S) {
    const wait = COOLDOWN_S - (nowS - last.ts);
    return NextResponse.json({ error: `this wallet was topped up recently; try again in ${Math.ceil(wait / 60)} minutes` }, { status: 429 });
  }

  // 1. cluster airdrop
  try {
    const sig = await conn.requestAirdrop(wallet, AIRDROP_SOL * LAMPORTS_PER_SOL);
    const bh = await conn.getLatestBlockhash();
    await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    db?.prepare("INSERT INTO faucet_claims (wallet, ts, lamports, method, signature) VALUES (?, ?, ?, 'airdrop', ?)").run(wallet.toBase58(), nowS, String(AIRDROP_SOL * LAMPORTS_PER_SOL), sig);
    return NextResponse.json({ ok: true, method: "airdrop", sol: AIRDROP_SOL, signature: sig, network: net });
  } catch (e) {
    // fall through to the faucet key
    console.warn("airdrop failed, falling back to faucet key:", (e as Error).message?.slice(0, 120));
  }
  // 2. transfer from the faucet key
  const fk = faucetKey();
  if (!fk) return NextResponse.json({ error: "cluster airdrop is rate-limited and no faucet key is configured; try https://faucet.solana.com" }, { status: 503 });
  const bal = await conn.getBalance(fk.publicKey);
  const lamports = TRANSFER_SOL * LAMPORTS_PER_SOL;
  if (bal < lamports + 10_000_000) return NextResponse.json({ error: "faucet is empty; try https://faucet.solana.com" }, { status: 503 });
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: fk.publicKey, toPubkey: wallet, lamports }));
  tx.feePayer = fk.publicKey;
  const sig = await sendAndConfirmTransaction(conn, tx, [fk], { commitment: "confirmed" });
  db?.prepare("INSERT INTO faucet_claims (wallet, ts, lamports, method, signature) VALUES (?, ?, ?, 'transfer', ?)").run(wallet.toBase58(), nowS, String(lamports), sig);
  return NextResponse.json({ ok: true, method: "transfer", sol: TRANSFER_SOL, signature: sig, network: net });
}

export async function GET() {
  const conn = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const net = await getNetwork(conn);
  const fk = faucetKey();
  const bal = fk ? (await conn.getBalance(fk.publicKey)) / LAMPORTS_PER_SOL : null;
  return NextResponse.json({ network: net, enabled: net !== "mainnet-beta", faucetSol: bal });
}
