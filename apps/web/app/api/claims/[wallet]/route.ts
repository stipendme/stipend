import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { openDb, getClaimable, getClosedDistributionsWithClaims, getLedger, getPayouts } from "@/lib/db";
import { loadRegistry } from "@/lib/registry";
import type { ClaimsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await ctx.params;
  try {
    new PublicKey(wallet);
  } catch {
    return NextResponse.json({ error: "Not a wallet address" }, { status: 400 });
  }
  const registry = loadRegistry();
  const db = openDb();
  const body: ClaimsResponse = db
    ? { wallet, claimable: getClaimable(db, registry, wallet), closed: getClosedDistributionsWithClaims(db, wallet), ledger: getLedger(db, registry, wallet), payouts: getPayouts(db, wallet) }
    : { wallet, claimable: [], closed: [], ledger: [], payouts: [] };
  db?.close();
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
