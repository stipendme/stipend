import { buildLstsResponse } from "@/lib/views";
import { Calculator } from "@/components/Calculator";

export const dynamic = "force-dynamic";

export default async function CalculatorPage({ searchParams }: { searchParams: Promise<{ lst?: string; sol?: string; years?: string }> }) {
  const sp = await searchParams;
  const data = await buildLstsResponse();
  const options = data.lsts.map((l) => ({
    symbol: l.entry.symbol,
    assetSymbol: l.entry.asset.symbol,
    assetName: l.entry.asset.name,
    assetPriceUsd: l.yield.assetPriceUsd,
    draft: l.entry.status === "draft",
  }));
  return (
    <>
      <h1 className="mb-2 text-[2rem] font-semibold tracking-tight">Calculator</h1>
      <p className="mb-8 max-w-[60ch] text-ink-2">
        An estimate of what a stake would pay, year by year, in the asset you choose. Prices are held at today&rsquo;s; Solana inflation steps down on the protocol schedule.
      </p>
      <Calculator
        validator={data.validator}
        platformFeeBps={data.platformFeeBps}
        options={options}
        initial={{ lst: sp.lst, sol: sp.sol ? Number(sp.sol) : undefined, years: sp.years ? Number(sp.years) : undefined }}
      />
    </>
  );
}
