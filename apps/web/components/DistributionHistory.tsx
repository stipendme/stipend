import { fmtDate, fmtSol, fmtUnits, fmtNum, shortAddr } from "@/lib/format";
import type { DistributionRow, LstEntry } from "@/lib/types";

export function DistributionHistory({ rows, entry }: { rows: DistributionRow[]; entry: LstEntry }) {
  if (rows.length === 0)
    return <p className="text-sm text-ink-2">No epochs processed yet. The first payout happens at the end of the first full epoch after launch.</p>;
  const direct = entry.delivery === "direct";
  return (
    <div className="w-full max-w-full overflow-x-auto">
      <table className="num w-full min-w-[640px] text-sm">
        <thead className="text-left text-ink-2">
          <tr className="border-b rule">
            <th className="py-2 font-normal">Epoch</th>
            <th className="py-2 font-normal">Date</th>
            <th className="py-2 text-right font-normal">SOL redeemed</th>
            <th className="py-2 text-right font-normal">Fill</th>
            <th className="py-2 text-right font-normal">Paid out</th>
            <th className="py-2 text-right font-normal">Holders</th>
            <th className="py-2 text-right font-normal">{direct ? "Swap" : "Distribution"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const inSol = Number(BigInt(r.swappedIn)) / 1e9;
            const out = Number(BigInt(r.assetOut)) / 10 ** entry.asset.decimals;
            const fill = inSol > 0 && out > 0 ? out / inSol : null;
            const link = direct ? r.swapSig && `https://solscan.io/tx/${r.swapSig}` : r.distribution && `https://solscan.io/account/${r.distribution}`;
            const label = direct ? r.swapSig : r.distribution;
            return (
              <tr key={r.epoch} className="border-b border-b-[color:var(--color-rule-2)]">
                <td className="py-2.5">{r.epoch}</td>
                <td className="py-2.5 text-ink-2">{fmtDate(r.startedAt)}</td>
                <td className="py-2.5 text-right">{fmtSol(r.solRedeemed, 3)}</td>
                <td className="py-2.5 text-right text-ink-2">{fill == null ? "–" : `${fmtNum(fill, 4)} ${entry.asset.symbol}/SOL`}</td>
                <td className="py-2.5 text-right">
                  {fmtUnits(r.assetOut, entry.asset.decimals)} {entry.asset.symbol}
                </td>
                <td className="py-2.5 text-right">{r.holders ?? "–"}</td>
                <td className="py-2.5 text-right">
                  {link && label ? (
                    <a className="font-mono text-ink-2 underline decoration-rule underline-offset-2" href={link} target="_blank" rel="noreferrer">
                      {shortAddr(label)}
                    </a>
                  ) : (
                    <span className="text-ink-2">–</span>
                  )}
                  <span className={`ml-2 ${r.status === "done" ? "text-credit" : r.status === "error" ? "text-debit" : "text-ink-2"}`}>{r.status === "done" ? "paid" : r.status}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
