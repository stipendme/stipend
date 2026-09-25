import Link from "next/link";
import { loadRegistry } from "@/lib/registry";
import { getValidatorYield } from "@/lib/yield";
import { FlowDiagram, CustodyDiagram, EpochTimeline, TaperChart } from "@/components/Diagrams";
import { fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

const pct = (f: { numerator: number; denominator: number }) => `${((f.numerator / f.denominator) * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

const SECTIONS: [string, string][] = [
  ["how", "How it works"],
  ["security", "Security"],
  ["yield", "Yield and inflation"],
  ["fees", "Fees"],
  ["delivery", "Delivery and rent"],
  ["launch", "Your own LST"],
  ["roadmap", "Roadmap"],
  ["sources", "Sources"],
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-16 mb-4 scroll-mt-24 text-[1.375rem] font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function Figure({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <figure className="docs-figure my-8 border-y rule py-6">
      {children}
      <figcaption className="mt-3 text-sm text-ink-2">{caption}</figcaption>
    </figure>
  );
}

export default async function DocsPage() {
  const r = loadRegistry();
  const v = await getValidatorYield(r);
  const feePct = r.fees.platformFeeBps / 100;
  const netApy = v.totalApy * (1 - r.fees.platformFeeBps / 10_000);
  const rates = [0, 1, 2, 3, 4, 5].map((y) => Math.max(v.terminal, v.inflationRate * Math.pow(1 - v.taper, y)));
  const live = r.lsts.filter((l) => l.status !== "draft").length;

  return (
    <article className="docs text-[1.0625rem] leading-relaxed">
      <header className="mb-6">
        <h1 className="text-[2.25rem] font-semibold leading-tight tracking-tight">How Stipend works</h1>
        <p className="mt-3 max-w-[60ch] text-ink-2">
          Stake SOL, hold a token that stays worth exactly one SOL, and receive the staking yield as a stock, a metal or another token, in
          your wallet, every epoch. Nothing custom on chain, nothing to claim, nothing locked.
        </p>
        <nav aria-label="Sections" className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {SECTIONS.map(([id, t]) => (
            <a key={id} href={`#${id}`} className="text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink">
              {t}
            </a>
          ))}
        </nav>
      </header>

      <H2 id="how">How it works</H2>
      <p className="text-ink-2">
        Each Stipend LST is a standard SPL stake pool token. The pool delegates everything to {r.validator.name} and keeps 100% of the staking
        reward as its epoch fee. Because the fee is the whole reward, one LST is always redeemable for one SOL and the token never appreciates.
        The yield leaves the pool as SOL every epoch and comes back to you as the asset the LST is named after.
      </p>
      <Figure caption="One pool per asset. Your SOL never leaves the stake pool program; only the epoch's yield moves.">
        <FlowDiagram />
      </Figure>
      <ol className="list-decimal space-y-2 pl-6 text-ink-2">
        <li>The protocol pays the epoch&rsquo;s staking reward into the pool&rsquo;s stake accounts at the epoch boundary.</li>
        <li>The pool is updated. The reward is minted to the pool as LST and redeemed for SOL from the reserve.</li>
        <li>The platform fee is taken (<a href="#fees" className="underline decoration-rule underline-offset-2">below</a>).</li>
        <li>Every wallet holding the LST is snapshotted at that moment. Only wallet balances count; LST sitting in a DEX pool or a lending market earns nothing until we add look-through for that venue.</li>
        <li>The remaining SOL is swapped into the asset on Jupiter, in one fill for the whole pool.</li>
        <li>The asset is transferred to each holder in proportion to their snapshot balance.</li>
      </ol>
      <Figure caption="Rewards land at the boundary; the worker runs within the hour; the rest of the epoch is ordinary holding.">
        <EpochTimeline />
      </Figure>
      <p className="text-ink-2">
        The snapshot, the fill and every transfer are recorded and shown on the <Link href="/stats" className="underline decoration-rule underline-offset-2">Stats</Link> page
        and on each LST&rsquo;s Epochs table, so anyone can rebuild the split from public data.
      </p>

      <H2 id="security">Security</H2>
      <p className="text-ink-2">
        Stipend runs no on-chain program of its own and never holds your SOL. Principal sits in the SPL stake pool program, the same audited
        program behind JitoSOL, bSOL and more than two hundred other LSTs. The program mints your LST when you deposit, burns it when you
        redeem, and nothing else can move that SOL. Stipend&rsquo;s keys only see one thing: the epoch&rsquo;s yield after it has been redeemed.
      </p>
      <Figure caption="What each party can and cannot do. Only the LST holder can turn LST back into SOL.">
        <CustodyDiagram />
      </Figure>
      <p className="text-ink-2">
        This matters because the alternative fails badly. Services that keep user funds in their own wallets or in an upgradeable program of
        their own are one leaked key or one bad upgrade from losing everything, and that is how staking products get drained. There is no
        equivalent path here: a compromise of Stipend&rsquo;s keys could, at worst, cost one epoch&rsquo;s undistributed yield and let an attacker
        raise the withdrawal fee within the program&rsquo;s limits, which the program caps and delays by an epoch so holders can leave first.
        It could not withdraw a single lamport of principal.
      </p>
      <dl className="mt-4 grid gap-y-2 text-[0.9375rem] text-ink-2 sm:grid-cols-[auto_1fr] sm:gap-x-6">
        <dt className="font-medium text-ink">If the manager key leaked</dt>
        <dd>Fees could be changed, next epoch, inside program limits; the current epoch&rsquo;s fee tokens could be redeemed by the attacker. Fix: rotate the manager. Principal untouched.</dd>
        <dt className="font-medium text-ink">If the staker key leaked</dt>
        <dd>Stake could be pointed at another validator or parked in the reserve, costing yield for an epoch or two. Fix: the manager replaces the staker. Principal untouched.</dd>
        <dt className="font-medium text-ink">If the worker key leaked</dt>
        <dd>One epoch&rsquo;s redeemed yield, in SOL or the asset, could be taken before it was paid out. Fix: new worker key. Principal untouched.</dd>
        <dt className="font-medium text-ink">If Stipend disappeared</dt>
        <dd>Your LST still redeems 1:1 through the stake pool program, and trades on Jupiter through Sanctum&rsquo;s router. Only the payouts would stop.</dd>
      </dl>

      <H2 id="yield">Yield and inflation</H2>
      <p className="text-ink-2">
        The one number shown across the site is the validator&rsquo;s staking yield net of the platform fee, currently about {fmtPct(netApy)} a
        year in SOL terms. It is not a quote from anyone. It is derived from two live inputs: Solana&rsquo;s inflation rate, read from the chain,
        and the share of all SOL that is staked. Staking yield is roughly inflation divided by that share, so it moves with both; MEV tips add a
        little on top. Once a pool has paid an epoch, the figures on its page switch from that estimate (marked ~) to what was actually paid per
        100 SOL over the trailing 30 days, annualised.
      </p>
      <p className="mt-3 text-ink-2">
        Inflation is on a fixed schedule set in the protocol&rsquo;s governor: it started at {fmtPct(v.initial * 100, 0)} and is reduced by
        {" "}{fmtPct(v.taper * 100, 0)} of itself each year until it reaches {fmtPct(v.terminal * 100, 1)}. It is {fmtPct(v.inflationRate * 100)} now.
        That is a step down of about {fmtPct(v.inflationRate * v.taper * 100)} next year, not fifteen points.
      </p>
      <Figure caption="Inflation rate on the protocol schedule. Yield also depends on how much SOL is staked, which the schedule does not fix.">
        <TaperChart rates={rates} terminal={v.terminal} />
      </Figure>
      <p className="text-ink-2">
        Two things pull the other way. Validators already keep 100% of priority fees since SIMD-0096 activated in February 2025, and the
        validator here shares MEV tips with stakers through Jito. SIMD-0123, approved by stake-weighted vote in March 2025 and on Anza&rsquo;s
        2026 delivery list, lets validators pass block revenue to their delegators in-protocol, on top of inflation. As network activity grows,
        a larger share of stakers&rsquo; return comes from fees and tips rather than issuance. Stipend pools receive whatever the validator
        shares, so that upside flows through to holders as more of the asset.
      </p>

      <H2 id="fees">Fees</H2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-ink-2">
        <dt>Platform fee</dt>
        <dd>{feePct}% of each epoch&rsquo;s yield. It funds the swaps, the payout transactions, and the token accounts Stipend opens for holders who arrived without one.</dd>
        <dt>Deposit (SOL)</dt>
        <dd>{pct(r.fees.solDepositFee)}</dd>
        <dt>Deposit (stake account)</dt>
        <dd>{pct(r.fees.stakeDepositFee)}</dd>
        <dt>Redeem to SOL</dt>
        <dd>{pct(r.fees.solWithdrawalFee)} of the amount, the market&rsquo;s standard. It is what stops someone minting just before a snapshot and redeeming just after: a day of yield is far less than the fee.</dd>
        <dt>Withdraw as stake</dt>
        <dd>{pct(r.fees.stakeWithdrawalFee)}</dd>
      </dl>
      <p className="mt-3 text-ink-2">
        Redemptions to SOL come from the pool reserve, which is kept at about {r.reserve.targetBps / 100}% of the pool. If the reserve is short,
        redeem less, wait for the next rebalance, or sell the LST on Jupiter, where Sanctum&rsquo;s router quotes it at par.
      </p>

      <H2 id="delivery">Delivery and rent</H2>
      <p className="text-ink-2">
        Payouts are plain token transfers to your wallet. Receiving a token on Solana needs a token account for it, which costs a small
        rent deposit. The rules:
      </p>
      <ul className="mt-3 list-disc space-y-2 pl-6 text-ink-2">
        <li>Mint on this site and the transaction opens your account for the asset at the same time. You pay the rent once, and the first epoch pays straight in.</li>
        <li>Arrived another way, through Jupiter or a transfer? Stipend opens your first account for you, out of the platform fee, after you have held through one full epoch.</li>
        <li>Close that account and the next one comes out of your own accrued payouts, so closing and reopening for the rent refund gains nothing.</li>
        <li>Rent spend per epoch is capped at a share of that epoch&rsquo;s fee. In a normal epoch the cap is never reached; if it ever is, the largest balances are funded first and the rest the epoch after.</li>
        <li>Amounts below a small minimum are carried in the ledger and paid once they clear it. Nothing expires.</li>
      </ul>

      <H2 id="launch">Your own LST</H2>
      <p className="text-ink-2">
        Any token can have a Stipend pool: a stock, a metal, a memecoin, a governance token. Holders of <em>tickerSOL</em> stake SOL and
        receive your token every epoch, which makes a standing market buy funded by other people&rsquo;s staking yield. The launcher posts a
        bond, the pool is created with the same keys and the same program as every other Stipend pool, and the launcher receives a share of the
        platform fee on that pool for as long as they hold the creator role.{" "}
        <Link href="/launch" className="underline decoration-rule underline-offset-2">
          Launch a pool.
        </Link>
      </p>

      <H2 id="roadmap">Roadmap</H2>
      <ul className="list-disc space-y-2 pl-6 text-ink-2">
        <li>{live > 0 ? `${live} pool${live === 1 ? "" : "s"} live` : "First pools opening"}; more assets from the tokenized stock, ETF and metal lists, then the majors.</li>
        <li>Run a Stipend validator as staked SOL grows, so the pools&rsquo; stake and the fee flow sit on infrastructure we operate end to end.</li>
        <li>Look-through for LST held in DEX pools and lending markets, so pairing your LST does not cost you the payout.</li>
        <li>Creator pools open to anyone, with published per-pool fee ledgers.</li>
      </ul>

      <H2 id="programs">Programs and keys</H2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 font-mono text-sm text-ink-2">
        <dt className="font-sans">Stake pool program</dt>
        <dd className="truncate">{r.programs.stakePool}</dd>
        <dt className="font-sans">Validator</dt>
        <dd className="truncate">{r.validator.voteAccount}</dd>
        {r.treasury && (
          <>
            <dt className="font-sans">Treasury</dt>
            <dd className="truncate">{r.treasury}</dd>
          </>
        )}
      </dl>
      <p className="mt-3 text-sm text-ink-2">Each LST&rsquo;s mint, pool, reserve and fee account are listed on its page.</p>

      <H2 id="sources">Sources</H2>
      <ul className="space-y-1.5 text-sm text-ink-2">
        <li>
          <a className="underline decoration-rule underline-offset-2" href="https://github.com/solana-program/stake-pool" target="_blank" rel="noreferrer">SPL stake pool program</a>, the program that holds every Stipend pool.
        </li>
        <li>
          Inflation governor and current rate: <code className="font-mono">getInflationGovernor</code> and <code className="font-mono">getInflationRate</code>, read live from the chain. Staking share from Solana Compass.
        </li>
        <li>
          <a className="underline decoration-rule underline-offset-2" href="https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0096-reward-collected-priority-fee-in-entirety.md" target="_blank" rel="noreferrer">SIMD-0096</a>, full priority fees to validators; activated on mainnet 12 February 2025 (<a className="underline decoration-rule underline-offset-2" href="https://www.theblock.co/post/296932/solana-validators-to-receive-full-priority-fees-as-simd-0096-proposal-gains-approval" target="_blank" rel="noreferrer">The Block</a>).
        </li>
        <li>
          <a className="underline decoration-rule underline-offset-2" href="https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0123-block-revenue-distribution.md" target="_blank" rel="noreferrer">SIMD-0123</a>, block revenue distribution to delegators; approved by vote March 2025, in Anza&rsquo;s 2026 plan (<a className="underline decoration-rule underline-offset-2" href="https://www.blockdaemon.com/blog/what-is-simd-123-and-how-will-it-change-institutional-sol-staking" target="_blank" rel="noreferrer">Blockdaemon</a>, <a className="underline decoration-rule underline-offset-2" href="https://solanacompass.com/projects/Anza" target="_blank" rel="noreferrer">Solana Compass</a>).
        </li>
        <li>
          <a className="underline decoration-rule underline-offset-2" href="https://github.com/igneous-labs/sanctum-lst-list" target="_blank" rel="noreferrer">Sanctum LST list</a>, which Jupiter&rsquo;s stake pool routing reads.
        </li>
      </ul>
    </article>
  );
}
