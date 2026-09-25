import { fmtQty, fmtUsd } from "@/lib/format";
import type { LstYield } from "@/lib/types";

/**
 * The memorable number: what 100 SOL pays in a year, in the asset. Set in the credit colour with tabular
 * numerals and no background, like the credit column of a statement. Cells carry no explainer; the table
 * header and footer do that once.
 */
export function YieldFigure({ y, assetSymbol, size = "md", note = false }: { y: LstYield; assetSymbol: string; size?: "md" | "xl"; note?: boolean }) {
  const big = size === "xl" ? "text-[2.75rem] leading-none sm:text-[4.25rem] tracking-tight" : "text-[1.375rem] leading-tight";
  const est = y.basis === "estimate";
  // Every projected quantity carries a leading "~". Realised figures (basis "paid") do not.
  const tilde = est ? <span className="mr-[0.08em] font-medium opacity-70" aria-label="approximately">~</span> : null;
  const figure =
    y.assetPer100SolYear == null ? (
      <span>
        {tilde}
        {fmtUsd(y.usdPer100SolYear)} <span className="text-[0.7em] font-medium">of {assetSymbol}</span>
      </span>
    ) : (
      <span>
        {tilde}
        {fmtQty(y.assetPer100SolYear)} <span className={size === "xl" ? "text-[0.6em] font-medium" : "font-medium"}>{assetSymbol}</span>
      </span>
    );
  return (
    <div>
      <div className={`num font-semibold text-credit ${big}`}>{figure}</div>
      {note && (
        <div className={`mt-2 text-ink-2 ${size === "xl" ? "text-base" : "text-sm"}`}>
          {est
            ? `per 100 SOL, a year, estimate at current prices (${fmtUsd(y.usdPer100SolYear)})`
            : `per 100 SOL, paid, last ${Math.round(y.realised!.days)} days, annualised (${fmtUsd(y.usdPer100SolYear)} at current prices)`}
        </div>
      )}
    </div>
  );
}
