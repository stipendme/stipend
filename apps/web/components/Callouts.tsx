import { fmtSol, fmtUsd } from "@/lib/format";
import type { SiteTotals } from "@/lib/types";

/** Four site-wide numbers. Anything that has not happened yet shows as a dash rather than a zero. */
export function Callouts({ t }: { t: SiteTotals }) {
  const staked = BigInt(t.stakedLamports);
  const items: [string, string][] = [
    ["SOL staked", staked > 0n ? `${fmtSol(staked, 0)} SOL` : "—"],
    ["Paid out to holders", t.paidOutUsd != null && t.paidOutUsd > 0 ? fmtUsd(t.paidOutUsd) : "—"],
    ["Holders", t.holders != null && t.holders > 0 ? t.holders.toLocaleString("en-US") : "—"],
    ["Epochs paid", t.epochsProcessed > 0 ? t.epochsProcessed.toLocaleString("en-US") : "—"],
  ];
  return (
    <dl className="num grid grid-cols-2 gap-x-6 border-y rule sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="py-3">
          <dt className="text-sm text-ink-2">{k}</dt>
          <dd className="text-[1.25rem] font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
