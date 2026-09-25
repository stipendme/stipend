import Link from "next/link";
import { LstLogo } from "./LstLogo";
import { YieldFigure } from "./YieldFigure";
import { fmtPct, fmtSol } from "@/lib/format";
import type { LstsResponse } from "@/lib/types";

export function LstLedger({ data }: { data: LstsResponse }) {
  const live = data.lsts.filter((l) => l.entry.status !== "draft");
  const anyPaid = data.lsts.some((l) => l.yield.basis === "paid");
  const anyEstimate = data.lsts.some((l) => l.yield.basis === "estimate");
  const coming = data.lsts.filter((l) => l.entry.status === "draft");
  const row = ({ entry, stats, yield: y }: LstsResponse["lsts"][number], draft: boolean) => (
    <div className="ledger-row" key={entry.symbol}>
      <div className={`c-name flex min-w-0 items-center gap-3 ${draft ? "opacity-80" : ""}`}>
        <LstLogo symbol={entry.symbol} size={32} />
        <div className="min-w-0">
          <div className="font-medium">{entry.symbol}</div>
          <div className="truncate text-sm text-ink-2">{entry.asset.name}</div>
        </div>
      </div>
      <div className="c-yield num text-right text-ink-2">{fmtPct(y.netApy)}</div>
      <div className={`c-figure ${draft ? "opacity-80" : ""}`}>
        <YieldFigure y={y} assetSymbol={entry.asset.symbol} />
      </div>
      <div className="c-tvl num text-right text-sm text-ink-2">
        {stats ? `${fmtSol(stats.totalLamports, 0)} SOL` : draft ? "coming" : "—"}
        {entry.status === "paused" && <div className="text-debit">paused</div>}
      </div>
      <div className="c-action text-right">
        <Link href={`/lst/${entry.symbol}`} className={draft ? "btn btn-quiet" : "btn"}>
          {draft ? "Preview" : `Mint ${entry.symbol}`}
        </Link>
      </div>
    </div>
  );
  return (
    <section aria-label="Pools">
      <div className="ledger-head">
        <div>Asset</div>
        <div className="text-right">Yield</div>
        <div>{anyPaid ? "Paid, last 30 days, annualised, per 100 SOL" : "Pays annually, per 100 SOL, estimate"}</div>
        <div className="text-right">Pool TVL</div>
        <div />
      </div>
      {live.map((l) => row(l, false))}
      {coming.map((l) => row(l, true))}
      <div className="border-t rule" />
      <p className="mt-3 max-w-[72ch] text-sm text-ink-2">
        {anyEstimate && "~ marks an estimate from the validator\u2019s current yield at current SOL and asset prices. "}
        {anyPaid && "Figures without ~ are what the pool actually paid per 100 SOL over the last 30 days, annualised. "}
        Staking yield follows Solana inflation, which steps down by about 15% of itself each year, and the share of SOL that is staked.
      </p>
    </section>
  );
}
