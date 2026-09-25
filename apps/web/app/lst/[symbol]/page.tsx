import Link from "next/link";
import { notFound } from "next/navigation";
import { buildLstsResponse } from "@/lib/views";
import { openDb, getDistributionHistory } from "@/lib/db";
import { LstLogo } from "@/components/LstLogo";
import { YieldFigure } from "@/components/YieldFigure";
import { MintRedeem } from "@/components/MintRedeem";
import { PayoutsPanel } from "@/components/PayoutsPanel";
import { DistributionHistory } from "@/components/DistributionHistory";
import { fmtPct, fmtSol, fmtCountdown } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LstPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const data = await buildLstsResponse();
  const view = data.lsts.find((l) => l.entry.symbol.toLowerCase() === symbol.toLowerCase());
  if (!view) notFound();
  const { entry, stats, yield: y } = view;
  const db = openDb();
  const history = db ? getDistributionHistory(db, entry.symbol, 30) : [];
  db?.close();
  const draft = entry.status === "draft";
  const reserveTarget = stats ? Math.max((Number(stats.totalLamports) * data.reserve.targetBps) / 10_000, data.reserve.minSol * 1e9) : 0;

  return (
    <>
      <p className="mb-6 text-sm text-ink-2">
        <Link href="/" className="underline decoration-rule underline-offset-2">
          Pools
        </Link>{" "}
        / {entry.symbol}
      </p>
      <section className="grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 max-w-full">
          <div className="flex items-center gap-4">
            <LstLogo symbol={entry.symbol} size={48} />
            <div>
              <h1 className="text-[2rem] font-semibold leading-none tracking-tight">{entry.symbol}</h1>
              <p className="mt-1 text-ink-2">
                Pays {entry.asset.symbol}, {entry.asset.name}, to your wallet every epoch.
                {draft && <span className="ml-2 text-credit">coming</span>}
                {entry.status === "paused" && <span className="ml-2 text-debit">paused</span>}
              </p>
            </div>
          </div>
          <div className="mt-8">
            <YieldFigure y={y} assetSymbol={entry.asset.symbol} size="xl" note />
            <p className="mt-3 max-w-[60ch] text-[0.9375rem] leading-relaxed text-ink-2">
              {y.basis === "paid"
                ? `Over the last ${Math.round(y.realised!.days)} days this pool paid ${y.realised!.epochs} epoch${y.realised!.epochs === 1 ? "" : "s"}. `
                : `~${fmtPct(y.netApy)} a year in SOL terms, estimated from the validator\u2019s current yield, paid in ${entry.asset.symbol} at each epoch\u2019s market price${y.assetPriceUsd ? ` (now $${y.assetPriceUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })})` : ""}. `}
              The quantity moves with SOL and {entry.asset.symbol} prices, with Solana inflation, which steps down by about 15% of itself each year, and with how much SOL is staked.{" "}
              <Link href={`/calculator?lst=${entry.symbol}`} className="underline decoration-rule underline-offset-2">
                Project your own stake.
              </Link>
            </p>
          </div>

          <h2 className="mt-12 mb-3 font-medium">Pool</h2>
          {stats ? (
            <div className="stat-grid num">
              <div className="stat">
                <div className="lbl">Pool TVL</div>
                <div className="val">{fmtSol(stats.totalLamports, 0)} SOL</div>
              </div>
              <div className="stat">
                <div className="lbl">{entry.symbol} supply</div>
                <div className="val">{fmtSol(stats.poolTokenSupply, 0)}</div>
              </div>
              <div className="stat">
                <div className="lbl">Holders</div>
                <div className="val">{stats.holders ?? "–"}</div>
              </div>
              <div className="stat">
                <div className="lbl">Liquid for redemption</div>
                <div className="val">{fmtSol(stats.reserveAvailableLamports, 1)} SOL</div>
              </div>
              <div className="stat">
                <div className="lbl">Reserve target</div>
                <div className="val">{fmtSol(reserveTarget, 1)} SOL</div>
              </div>
              <div className="stat">
                <div className="lbl">Yield awaiting swap</div>
                <div className="val">{fmtSol(stats.pendingFeeTokens, 3)} SOL</div>
              </div>
              <div className="stat">
                <div className="lbl">Epoch {data.validator.currentEpoch ?? "–"} ends in</div>
                <div className="val">{fmtCountdown(data.validator.epochEndsAt)}</div>
              </div>
              <div className="stat">
                <div className="lbl">Last pool update</div>
                <div className="val">epoch {stats.lastUpdateEpoch}</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-2">{draft ? "This pool has not been created yet. Numbers above are projections from the validator's current yield." : "Pool stats are unavailable right now."}</p>
          )}

          <h2 className="mt-12 mb-3 font-medium">Epochs</h2>
          <DistributionHistory rows={history} entry={entry} />

          <h2 className="mt-12 mb-3 font-medium">Addresses</h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 font-mono text-sm [&_dd]:min-w-0 [&_dd]:break-all">
            {[
              ["Mint", entry.mint],
              ["Stake pool", entry.stakePool],
              ["Reserve", entry.reserve],
              ["Fee account", entry.managerFeeAccount],
              ["Pays", entry.asset.mint],
              ["Validator", data.validatorVote],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-sans text-ink-2">{k}</dt>
                <dd className="truncate">
                  {v ? (
                    <a className="underline decoration-rule underline-offset-2" href={`https://solscan.io/account/${v}`} target="_blank" rel="noreferrer">
                      {v}
                    </a>
                  ) : (
                    <span className="text-ink-2">not created</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div className="border rule p-5">
            <MintRedeem view={view} withdrawalFee={data.fees.solWithdrawalFee} />
          </div>
          <div className="mt-5 border rule p-5">
            <h2 className="mb-3 font-medium">Your {entry.asset.symbol}</h2>
            <PayoutsPanel entry={entry} />
          </div>
        </aside>
      </section>
    </>
  );
}
