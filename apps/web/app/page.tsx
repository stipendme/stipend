import Link from "next/link";
import { buildLstsResponse } from "@/lib/views";
import { LstLedger } from "@/components/LstLedger";
import { Callouts } from "@/components/Callouts";
import { fmtPct, fmtUsd, fmtCountdown } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await buildLstsResponse();
  const v = data.validator;
  const netApy = v.totalApy * (1 - data.platformFeeBps / 10_000);
  return (
    <>
      <section className="mb-8 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <h1 className="max-w-[16ch] text-[2.25rem] font-semibold leading-[1.05] tracking-tight sm:text-[3.25rem]">
            Stake SOL. Get paid in stocks.
          </h1>
          <p className="mt-4 max-w-[52ch] text-[1.0625rem] leading-relaxed text-ink-2">
            Every Stipend LST stays 1:1 with SOL. Its staking yield is swapped into one asset each epoch and sent to whoever holds the token.
            Keep it in your wallet, trade it, pair it. The stock lands in your wallet every epoch.
          </p>
        </div>
        <dl className="num grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-ink-2 sm:text-right">
          <dt>Yield</dt>
          <dd className="text-ink">{fmtPct(netApy)}</dd>
          <dt>Epoch {v.currentEpoch ?? "–"} ends in</dt>
          <dd className="text-ink">{fmtCountdown(v.epochEndsAt)}</dd>
          <dt>SOL</dt>
          <dd className="text-ink">{v.solPriceUsd ? fmtUsd(v.solPriceUsd) : "–"}</dd>
        </dl>
      </section>
      <div className="mb-10">
        <Callouts t={data.totals} />
      </div>
      <LstLedger data={data} />
      <section className="mt-16 grid gap-8 text-[0.9375rem] leading-relaxed text-ink-2 sm:grid-cols-3">
        <div>
          <h2 className="mb-1 font-medium text-ink">Mint</h2>
          Deposit SOL into the pool for the asset you want. You get the same number of LST back. Existing stake accounts can be deposited too.
        </div>
        <div>
          <h2 className="mb-1 font-medium text-ink">Hold</h2>
          Each epoch the pool&rsquo;s yield is redeemed, swapped on Jupiter and split across holders by balance. The snapshot and fill are
          published so anyone can check the maths.
        </div>
        <div>
          <h2 className="mb-1 font-medium text-ink">Get paid</h2>
          The asset is sent straight to your wallet every epoch. Nothing to claim, nothing to lock.{" "}
          <Link href="/calculator" className="underline decoration-rule underline-offset-2">
            Project what your stake would pay.
          </Link>
        </div>
      </section>
    </>
  );
}
