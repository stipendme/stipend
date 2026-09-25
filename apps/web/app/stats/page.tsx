import { buildLstsResponse } from "@/lib/views";
import { loadRegistry } from "@/lib/registry";
import { openDb, getStatsEpochRows, getStatsLstRows } from "@/lib/db";
import { Callouts } from "@/components/Callouts";
import { LstLogo } from "@/components/LstLogo";
import { fmtDate, fmtNum, fmtSol, fmtUnits, fmtUsd, shortAddr } from "@/lib/format";
import { TvlChart } from "@/components/TvlChart";
import { buildTvlResponse, loadTvlHistory, tvlSeries } from "@/lib/tvl";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const data = await buildLstsResponse();
  const registry = loadRegistry();
  const db = openDb();
  const epochs = db ? getStatsEpochRows(db, registry, 200) : [];
  const perLst = db ? getStatsLstRows(db, registry) : [];
  db?.close();
  const live = perLst.filter((r) => r.epochsRun > 0);
  const tvl = await buildTvlResponse();
  const history = loadTvlHistory(Math.floor(Date.now() / 1000) - 365 * 86_400);
  const liveSymbols = registry.lsts.filter((l) => l.status !== "draft").map((l) => l.symbol);
  const { total, per } = tvlSeries(history, liveSymbols);
  const paidPrices = new Map(data.lsts.map((l) => [l.entry.symbol, l.yield.assetPriceUsd]));

  return (
    <>
      <h1 className="mb-2 text-[2rem] font-semibold tracking-tight">Stats</h1>
      <p className="mb-8 max-w-[60ch] text-ink-2">Everything the worker has done, epoch by epoch. This page grows as pools go live.</p>
      <Callouts t={data.totals} />

      <h2 className="mt-12 mb-1 font-medium">SOL staked over time</h2>
      <p className="mb-4 text-sm text-ink-2">
        {tvl.totalSol > 0 ? `${fmtNum(tvl.totalSol, 0)} SOL across ${tvl.byAsset.filter((a) => a.sol > 0).length} pool${tvl.byAsset.filter((a) => a.sol > 0).length === 1 ? "" : "s"}` : "Nothing staked yet"}
        {tvl.totalUsd ? `, ${fmtUsd(tvl.totalUsd)}` : ""}
        {tvl.updatedAt ? `. Sampled hourly, last at ${new Date(tvl.updatedAt * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : "."}
      </p>
      <TvlChart series={[{ label: "Total", points: total, emphasis: true }, ...per.filter((s) => s.points.length > 1).map((s) => ({ label: s.symbol, points: s.points }))]} />

      <h2 className="mt-12 mb-3 font-medium">Paid out, lifetime</h2>
      {live.length === 0 ? (
        <p className="text-sm text-ink-2">No pool has paid an epoch yet.</p>
      ) : (
        <dl className="num grid grid-cols-2 gap-x-6 border-y rule sm:grid-cols-4">
          {live.map((r) => {
            const units = Number(BigInt(r.totalDistributed)) / 10 ** r.assetDecimals;
            const price = paidPrices.get(r.lstSymbol) ?? null;
            return (
              <div key={r.lstSymbol} className="py-3">
                <dt className="text-sm text-ink-2">{r.lstSymbol}</dt>
                <dd className="text-[1.25rem] font-medium text-credit">
                  {fmtUnits(r.totalDistributed, r.assetDecimals)} {r.assetSymbol}
                </dd>
                {price ? <dd className="text-sm text-ink-2">{fmtUsd(units * price)} at today&rsquo;s price</dd> : null}
              </div>
            );
          })}
        </dl>
      )}

      <h2 className="mt-12 mb-3 font-medium">By pool</h2>
      {live.length === 0 ? (
        <p className="text-sm text-ink-2">No pool has paid an epoch yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th>Pool</th>
                <th className="r">Epochs paid</th>
                <th className="r">SOL yield redeemed</th>
                <th className="r">Asset paid out</th>
                <th className="r">Holders</th>
                <th className="r">Last epoch</th>
              </tr>
            </thead>
            <tbody>
              {live.map((r) => (
                <tr key={r.lstSymbol}>
                  <td>
                    <span className="flex items-center gap-2">
                      <LstLogo symbol={r.lstSymbol} size={22} />
                      {r.lstSymbol}
                    </span>
                  </td>
                  <td className="r">{r.epochsRun}</td>
                  <td className="r">{fmtSol(r.totalRedeemedLamports, 3)} SOL</td>
                  <td className="r text-credit">
                    {fmtUnits(r.totalDistributed, r.assetDecimals)} {r.assetSymbol}
                  </td>
                  <td className="r">{r.holdersLast ?? "–"}</td>
                  <td className="r">{r.lastEpoch ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-12 mb-3 font-medium">Epochs</h2>
      {epochs.length === 0 ? (
        <p className="text-sm text-ink-2">The first row appears at the end of the first full epoch after launch.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table min-w-[820px]">
            <thead>
              <tr>
                <th>Epoch</th>
                <th>Pool</th>
                <th>Date</th>
                <th className="r">SOL redeemed</th>
                <th className="r">Asset bought</th>
                <th className="r">Fill</th>
                <th className="r">Holders paid</th>
                <th className="r">Txs</th>
                <th className="r">Swap</th>
              </tr>
            </thead>
            <tbody>
              {epochs.map((r) => {
                const inSol = Number(BigInt(r.swappedIn)) / 1e9;
                const out = Number(BigInt(r.assetOut)) / 10 ** r.assetDecimals;
                const fill = inSol > 0 && out > 0 ? out / inSol : null;
                return (
                  <tr key={`${r.lstSymbol}-${r.epoch}`}>
                    <td>{r.epoch}</td>
                    <td>{r.lstSymbol}</td>
                    <td className="text-ink-2">{fmtDate(r.startedAt)}</td>
                    <td className="r">{fmtSol(r.solRedeemed, 3)}</td>
                    <td className="r">
                      {fmtUnits(r.assetOut, r.assetDecimals)} {r.assetSymbol}
                    </td>
                    <td className="r text-ink-2">{fill == null ? "–" : `${fmtNum(fill, 4)} ${r.assetSymbol}/SOL`}</td>
                    <td className="r">{r.holdersPaid || (r.holders ?? "–")}</td>
                    <td className="r">{r.payoutTxs || "–"}</td>
                    <td className="r">
                      {r.swapSig ? (
                        <a className="font-mono text-ink-2 underline decoration-rule underline-offset-2" href={`https://solscan.io/tx/${r.swapSig}`} target="_blank" rel="noreferrer">
                          {shortAddr(r.swapSig)}
                        </a>
                      ) : (
                        <span className="text-ink-2">{r.status === "done" ? "carried" : r.status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
