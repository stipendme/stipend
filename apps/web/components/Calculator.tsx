"use client";

import { useMemo, useState } from "react";
import { projectYieldClient } from "@/lib/project-client";
import { fmtNum, fmtPct, fmtQty, fmtUsd } from "@/lib/format";
import type { ValidatorYield } from "@/lib/types";
import { LstLogo } from "./LstLogo";

interface Option { symbol: string; assetSymbol: string; assetName: string; assetPriceUsd: number | null; draft: boolean }

export function Calculator({ validator, platformFeeBps, options, initial }: { validator: ValidatorYield; platformFeeBps: number; options: Option[]; initial: { lst?: string; sol?: number; years?: number } }) {
  const first = options.find((o) => o.symbol.toLowerCase() === initial.lst?.toLowerCase()) ?? options[0];
  const [lst, setLst] = useState(first?.symbol ?? "");
  const [sol, setSol] = useState(String(initial.sol && initial.sol > 0 ? initial.sol : 100));
  const [years, setYears] = useState(Math.min(10, Math.max(1, initial.years ?? 5)));
  const [advanced, setAdvanced] = useState(false);
  const [solPrice, setSolPrice] = useState<string>("");
  const [assetPrice, setAssetPrice] = useState<string>("");
  const [participation, setParticipation] = useState<string>("");

  const opt = options.find((o) => o.symbol === lst) ?? first;
  const solAmount = Math.max(0, Number(sol) || 0);
  const solP = Number(solPrice) > 0 ? Number(solPrice) : validator.solPriceUsd;
  const assetP = Number(assetPrice) > 0 ? Number(assetPrice) : (opt?.assetPriceUsd ?? 0);
  const part = Number(participation) > 0 && Number(participation) < 100 ? Number(participation) / 100 : validator.participation;

  const rows = useMemo(
    () => (opt ? projectYieldClient(validator, platformFeeBps, { solAmount, years, assetPriceUsd: assetP, solPriceUsd: solP, participation: part }) : []),
    [opt, validator, platformFeeBps, solAmount, years, assetP, solP, part],
  );
  const last = rows[rows.length - 1];
  const yearOne = rows[0];

  if (!opt) return <p className="text-ink-2">No pools in the registry yet.</p>;

  return (
    <div className="grid gap-10 lg:grid-cols-[360px_1fr]">
      <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
        <div>
          <label className="block text-sm text-ink-2" htmlFor="sol">
            SOL to stake
          </label>
          <input id="sol" className="field mt-1" inputMode="decimal" value={sol} onChange={(e) => setSol(e.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
        <div>
          <span className="block text-sm text-ink-2">Paid in</span>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            {options.map((o) => (
              <button
                key={o.symbol}
                type="button"
                onClick={() => {
                  setLst(o.symbol);
                  setAssetPrice("");
                }}
                aria-pressed={o.symbol === lst}
                className={`flex items-center gap-2 rounded-[6px] border px-2 py-1.5 text-left text-sm ${o.symbol === lst ? "border-ink" : "border-rule text-ink-2 hover:border-ink hover:text-ink"}`}
              >
                <LstLogo symbol={o.symbol} size={20} />
                <span className="truncate">{o.assetSymbol}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="flex items-baseline justify-between text-sm text-ink-2" htmlFor="years">
            <span>Years</span>
            <span className="num text-ink">{years}</span>
          </label>
          <input id="years" type="range" min={1} max={10} step={1} value={years} onChange={(e) => setYears(Number(e.target.value))} className="mt-2 w-full accent-[color:var(--color-credit)]" />
        </div>
        <button type="button" className="text-sm text-ink-2 underline decoration-rule underline-offset-2" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? "Hide assumptions" : "Change assumptions"}
        </button>
        {advanced && (
          <div className="space-y-4 border-t rule pt-4">
            <div>
              <label className="block text-sm text-ink-2" htmlFor="solp">
                SOL price, USD
              </label>
              <input id="solp" className="field mt-1" inputMode="decimal" placeholder={fmtNum(validator.solPriceUsd, 2)} value={solPrice} onChange={(e) => setSolPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            <div>
              <label className="block text-sm text-ink-2" htmlFor="assetp">
                {opt.assetSymbol} price, USD
              </label>
              <input id="assetp" className="field mt-1" inputMode="decimal" placeholder={opt.assetPriceUsd ? fmtNum(opt.assetPriceUsd, 2) : "no live price"} value={assetPrice} onChange={(e) => setAssetPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            <div>
              <label className="block text-sm text-ink-2" htmlFor="part">
                Share of SOL staked, %
              </label>
              <input id="part" className="field mt-1" inputMode="decimal" placeholder={fmtNum(validator.participation * 100, 1)} value={participation} onChange={(e) => setParticipation(e.target.value.replace(/[^0-9.]/g, ""))} />
              <p className="mt-1 text-xs text-ink-2">Less staked SOL means each staker gets a bigger share of inflation.</p>
            </div>
            <p className="text-xs text-ink-2">
              Inflation is {fmtPct(validator.inflationRate * 100)} now and is reduced by {fmtPct(validator.taper * 100, 0)} of itself each year ({fmtPct(validator.inflationRate * 100)} → {fmtPct(validator.inflationRate * (1 - validator.taper) * 100)} → {fmtPct(validator.inflationRate * (1 - validator.taper) ** 2 * 100)} …) until it reaches {fmtPct(validator.terminal * 100, 1)}. Staking yield is inflation divided by the share of SOL staked. MEV adds {fmtPct(validator.mevApy)}.
            </p>
          </div>
        )}
      </form>

      <div>
        {assetP > 0 && last ? (
          <p className="text-[1.375rem] leading-snug sm:text-[1.625rem]">
            Staking <span className="num font-medium">{fmtNum(solAmount, 2)} SOL</span> as {opt.symbol} would pay an estimated{" "}
            <span className="num font-semibold text-credit">
              ~{fmtQty(last.cumulativeAssetUnits)} {opt.assetSymbol}
            </span>{" "}
            over {years} {years === 1 ? "year" : "years"} at today&rsquo;s prices, worth ~{fmtUsd(last.cumulativeUsd)}.
          </p>
        ) : (
          <p className="text-[1.375rem] leading-snug text-ink-2">Enter a {opt.assetSymbol} price to project quantities. The SOL yield is shown below either way.</p>
        )}
        {yearOne && (
          <p className="mt-2 text-sm text-ink-2">
            Year one pays ~{fmtPct(yearOne.netApyPct)} in SOL terms{assetP > 0 ? `, about ~${fmtNum(yearOne.assetUnits / validator.epochsPerYear, 5)} ${opt.assetSymbol} per epoch` : ""}.
          </p>
        )}
        <div className="mt-6 overflow-x-auto">
          <table className="data-table min-w-[560px]">
            <thead>
              <tr>
                <th>Year</th>
                <th className="r">Inflation</th>
                <th className="r">Yield</th>
                <th className="r">SOL yield</th>
                <th className="r">{opt.assetSymbol} that year</th>
                <th className="r">Cumulative</th>
                <th className="r">Cumulative USD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year}>
                  <td>{r.year}</td>
                  <td className="r text-ink-2">{fmtPct(r.inflationRate * 100)}</td>
                  <td className="r">{fmtPct(r.netApyPct)}</td>
                  <td className="r">{fmtNum(r.solYield, 3)}</td>
                  <td className="r text-credit">{assetP > 0 ? `~${fmtQty(r.assetUnits)}` : "–"}</td>
                  <td className="r font-medium text-credit">{assetP > 0 ? `~${fmtQty(r.cumulativeAssetUnits)}` : "–"}</td>
                  <td className="r text-ink-2">~{fmtUsd(r.cumulativeUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-[60ch] text-sm text-ink-2">
          Every figure here is an estimate (~). Yield is the validator&rsquo;s staking return net of the platform fee, compounded per epoch. Principal never compounds: the LST stays 1:1
          with SOL and the yield leaves as {opt.assetSymbol}. Prices are held at the inputs; real payouts use each epoch&rsquo;s fill.
          {opt.draft && " This pool is not open yet."}
        </p>
      </div>
    </div>
  );
}
