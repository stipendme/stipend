import { PublicKey } from "@solana/web3.js";
import { snapshotHolders, getClaimable, getLedger, getPoolStats, getPrices, recordTvl, SOL_MINT } from "@stipend/core";
import { makeCtx, pickLsts, sol, table, units } from "../lib/ctx.js";
import { epochRun, epochSettle } from "./epoch.js";
import { getNetwork } from "@stipend/core";

export async function snapshotCmd(args: { lst?: string; top?: string }) {
  const ctx = makeCtx();
  const [l] = pickLsts(ctx, args.lst, true);
  if (!l.mint) throw new Error(`${l.symbol} has no mint yet`);
  const exclude = [...ctx.reg.snapshot.excludeOwners, ctx.reg.treasury].filter(Boolean);
  const s = await snapshotHolders(ctx.conn, new PublicKey(l.mint), exclude);
  console.log(`slot ${s.slot}: ${s.balances.size} holders, total ${sol(s.total)} ${l.symbol}`);
  const rows = [...s.balances.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, Number(args.top ?? 50)).map(([owner, bal]) => ({ owner, balance: sol(bal), share: s.total > 0n ? ((Number(bal) / Number(s.total)) * 100).toFixed(3) + "%" : "" }));
  table(rows);
}

export async function proofsCmd(args: { lst?: string; wallet?: string }) {
  const ctx = makeCtx();
  if (!args.wallet) throw new Error("--wallet required");
  const rows = getClaimable(ctx.db, args.wallet, (sym) => { const l = ctx.reg.lsts.find((x) => x.symbol === sym); return l && { assetSymbol: l.asset.symbol, assetMint: l.asset.mint, assetDecimals: l.asset.decimals, tokenProgram: l.asset.tokenProgram }; })
    .filter((r) => !args.lst || r.lstSymbol.toLowerCase() === args.lst.toLowerCase());
  for (const r of rows) console.log(JSON.stringify({ ...r, totalAmountUi: units(r.totalAmount, r.assetDecimals) }, null, 2));
  if (args.lst) console.log("ledger:", getLedger(ctx.db, args.lst, args.wallet));
  if (rows.length === 0) console.log("no open claims for", args.wallet);
}

/** One TVL sample per live LST into tvl_history (total lamports, supply, holders from the last snapshot, SOL price). */
export async function sampleTvl(ctx: ReturnType<typeof makeCtx>) {
  const lsts = ctx.reg.lsts.filter((l) => l.status !== "draft" && l.stakePool);
  if (lsts.length === 0) return;
  let solPrice: number | null = null;
  try { solPrice = (await getPrices([SOL_MINT]))[SOL_MINT] ?? null; } catch { /* price optional */ }
  const ts = Math.floor(Date.now() / 1000);
  for (const l of lsts) {
    try {
      const s = await getPoolStats(ctx.conn, l);
      const snap = ctx.db.prepare("SELECT holders FROM snapshots WHERE lst = ? ORDER BY epoch DESC LIMIT 1").get(l.symbol) as { holders: number } | undefined;
      recordTvl(ctx.db, { ts, lst: l.symbol, totalLamports: s.totalLamports.toString(), supply: s.poolTokenSupply.toString(), holders: snap?.holders ?? null, solPriceUsd: solPrice });
    } catch (e) { ctx.log(`${l.symbol}: tvl sample failed: ${(e as Error).message}`); }
  }
  ctx.log(`tvl sampled for ${lsts.length} LST(s)`);
}

export async function tvlCmd() {
  const ctx = makeCtx();
  await sampleTvl(ctx);
  table((ctx.db.prepare("SELECT lst, ts, total_lamports, supply, holders, sol_price_usd FROM tvl_history ORDER BY ts DESC LIMIT 20").all() as Record<string, unknown>[]).map((r) => ({ ...r, ts: new Date(Number(r.ts) * 1000).toISOString(), total_sol: sol(BigInt(String(r.total_lamports))) })));
}

/**
 * Loop: every 5 minutes check the epoch; on a new epoch run all live LSTs; retry settlement while any epoch is waiting.
 * TVL is sampled hourly and right after each epoch run.
 */
export async function cronCmd(args: { intervalSec?: string }) {
  const interval = Number(args.intervalSec ?? 300) * 1000;
  let lastEpoch = -1;
  let lastTvl = 0;
  const ctx = makeCtx();
  const net = await getNetwork(ctx.conn);
  const demo = net !== "mainnet-beta" && ctx.reg.demo?.enabled ? ctx.reg.demo : null;
  let lastDemo = -1;
  ctx.log(`cron started on ${net}; checking every ${interval / 1000}s${demo ? `; demo epochs every ${demo.intervalMinutes} min` : ""}`);
  for (;;) {
    try {
      if (demo) {
        const d = Math.floor(Date.now() / 1000 / (demo.intervalMinutes * 60));
        if (d !== lastDemo) { ctx.log(`demo epoch ${d}`); await epochRun({ demo: true }); lastDemo = d; await sampleTvl(ctx); lastTvl = Date.now(); }
      }
      const epoch = (await ctx.conn.getEpochInfo()).epoch;
      if (epoch !== lastEpoch) {
        ctx.log(`epoch ${epoch} seen`);
        await epochRun({});
        lastEpoch = epoch;
        await sampleTvl(ctx);
        lastTvl = Date.now();
      } else {
        await epochSettle({});
      }
      if (Date.now() - lastTvl >= 3_600_000) {
        await sampleTvl(ctx);
        lastTvl = Date.now();
      }
    } catch (e) { ctx.log(`cron error: ${(e as Error).message}`); }
    await new Promise((r) => setTimeout(r, interval));
  }
}
