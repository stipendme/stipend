"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { fetchLaunchMenu, prepare, runLaunch, type LaunchAsset, type LaunchMenu, type Prepared } from "@/lib/launch-client";
import { fmtSol } from "@/lib/format";
import { errorMessage } from "./TxStatus";

const GROUPS: { key: LaunchAsset["group"]; label: string }[] = [
  { key: "stocks", label: "Stocks and ETFs" },
  { key: "metals", label: "Metals" },
  { key: "majors", label: "Majors" },
  { key: "other", label: "Other verified tokens" },
];

type Phase =
  | { kind: "pick" }
  | { kind: "preparing" }
  | { kind: "running"; prepared: Prepared; step: number; total: number; label: string; phase: string; sigs: string[] }
  | { kind: "done"; prepared: Prepared; sigs: string[]; addresses: Record<string, string> }
  | { kind: "error"; message: string; prepared?: Prepared };

export function LaunchWizard({ brand, validatorName }: { brand: string; validatorName: string }) {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const { setVisible } = useWalletModal();
  const [menu, setMenu] = useState<LaunchMenu | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [asset, setAsset] = useState<LaunchAsset | null>(null);
  const [symbol, setSymbol] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });

  useEffect(() => {
    fetchLaunchMenu().then(setMenu).catch((e) => setMenuError(errorMessage(e)));
  }, []);

  const filtered = useMemo(() => {
    if (!menu) return [];
    const q = query.trim().toLowerCase();
    return menu.assets.filter((a) => !q || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.ticker.toLowerCase().includes(q));
  }, [menu, query]);

  function pick(a: LaunchAsset) {
    setAsset(a);
    setSymbol(`${a.ticker.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}SOL`);
  }

  const symbolOk = /^[a-z0-9]{2,8}SOL$/i.test(symbol) && !(menu?.symbols ?? []).some((s) => s.toLowerCase() === symbol.toLowerCase() && s !== symbol);
  const costs = menu?.quote.costs;
  const total = costs ? BigInt(costs.totalLamports) : 0n;
  const seed = costs ? BigInt(costs.seedLamports) : 0n;
  const rent = total - seed;

  async function go() {
    if (!publicKey || !signTransaction) return setVisible(true);
    if (!asset) return;
    let prepared: Prepared | undefined;
    try {
      setPhase({ kind: "preparing" });
      prepared = await prepare({ assetMint: asset.mint, symbol, creator: publicKey.toBase58() });
      const p = prepared;
      setPhase({ kind: "running", prepared: p, step: 0, total: p.steps.length, label: p.steps[0].label, phase: "sign", sigs: [] });
      const res = await runLaunch(p.id, signTransaction, (s) => {
        setPhase((prev) => ({ kind: "running", prepared: p, step: s.step, total: s.total, label: s.label, phase: s.phase, sigs: prev.kind === "running" ? (s.signature ? [...prev.sigs, s.signature] : prev.sigs) : [] }));
      }, signAllTransactions ?? undefined);
      setPhase({ kind: "done", prepared: p, sigs: res.signatures, addresses: res.addresses ?? p.addresses });
    } catch (e) {
      setPhase({ kind: "error", message: errorMessage(e), prepared });
    }
  }

  if (menuError) return <p className="text-debit">{menuError}</p>;
  if (!menu) return <p className="text-ink-2">Loading the asset list…</p>;
  if (!menu.quote.enabled) return <p className="text-ink-2">Launches are not open on this server yet.</p>;

  if (phase.kind === "done") {
    return (
      <section className="max-w-[62ch]">
        <h2 className="text-xl font-semibold">{phase.prepared.symbol} is live</h2>
        <p className="mt-2 text-ink-2">It pays {asset?.symbol} to whoever holds it, every epoch, starting with the next one. Your {fmtSol(seed)} SOL seed is already in the pool as {phase.prepared.symbol}.</p>
        <dl className="num mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {Object.entries(phase.addresses).filter(([k]) => ["pool", "mint", "reserve", "validatorList"].includes(k)).map(([k, v]) => (
            <Row key={k} k={k} v={v} />
          ))}
        </dl>
        <p className="mt-6 text-sm text-ink-2">Transactions: {phase.sigs.map((s) => <a key={s} className="mr-3 underline" href={`https://solscan.io/tx/${s}`} target="_blank" rel="noreferrer">{s.slice(0, 8)}…</a>)}</p>
        <a className="btn mt-6 inline-block" href={`/lst/${phase.prepared.symbol}`}>Open {phase.prepared.symbol}</a>
      </section>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section>
        <label className="block text-sm text-ink-2" htmlFor="q">Asset</label>
        <input id="q" className="field mt-1" placeholder="Search NVDA, gold, BTC…" value={query} onChange={(e) => setQuery(e.target.value)} disabled={phase.kind !== "pick" && phase.kind !== "error"} />
        <div className="mt-4 max-h-[28rem] overflow-y-auto rounded border rule">
          {GROUPS.map((g) => {
            const rows = filtered.filter((a) => a.group === g.key);
            if (rows.length === 0) return null;
            return (
              <div key={g.key}>
                <div className="sticky top-0 bg-paper px-3 py-1.5 text-xs text-ink-2">{g.label}</div>
                {rows.map((a) => (
                  <button
                    key={a.mint}
                    type="button"
                    disabled={!!a.taken || (phase.kind !== "pick" && phase.kind !== "error")}
                    aria-pressed={asset?.mint === a.mint}
                    onClick={() => pick(a)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-paper-2 disabled:opacity-50 ${asset?.mint === a.mint ? "bg-paper-2" : ""}`}
                  >
                    {a.logo ? <img src={a.logo} alt="" width={22} height={22} className="rounded-full" /> : <span className="inline-block h-[22px] w-[22px] rounded-full bg-rule" />}
                    <span className="flex-1">
                      <span className="font-medium">{a.symbol}</span>
                      <span className="ml-2 text-sm text-ink-2">{a.name}</span>
                    </span>
                    {a.taken && <span className="text-xs text-ink-2">already {a.taken}</span>}
                  </button>
                ))}
              </div>
            );
          })}
          {filtered.length === 0 && <p className="p-3 text-sm text-ink-2">Nothing matches. Tokens need to be on the curated stocks, metals or majors lists, or Jupiter-verified with real liquidity.</p>}
        </div>
      </section>

      <aside>
        <label className="block text-sm text-ink-2" htmlFor="sym">Token symbol</label>
        <input id="sym" className="field mt-1" value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/[^a-z0-9]/gi, ""))} placeholder="nvdaSOL" disabled={!asset || (phase.kind !== "pick" && phase.kind !== "error")} />
        {symbol && !symbolOk && <p className="mt-1 text-sm text-debit">2 to 8 letters or digits, ending in SOL, not already taken.</p>}

        <dl className="num mt-5 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm text-ink-2">
          <dt>Seed deposit</dt><dd className="text-right text-ink">{fmtSol(seed)} SOL</dd>
          <dt>Account rent</dt><dd className="text-right text-ink">{fmtSol(rent, 4)} SOL</dd>
          <dt>You pay now</dt><dd className="text-right text-ink">{fmtSol(total, 4)} SOL</dd>
          <dt>You get back</dt><dd className="text-right text-ink">{fmtSol(seed)} {symbol || "LST"}</dd>
          <dt>Your share</dt><dd className="text-right text-ink">{menu.quote.creatorFeeBps / 100}% of the platform fee</dd>
        </dl>
        <p className="mt-4 text-sm text-ink-2">
          The seed comes back to you as the first {symbol || "LST"} ever minted; it stays 1:1 with SOL and earns like any other. The pool delegates to {validatorName}. {brand} holds the manager and staker keys; nobody can withdraw your holders&rsquo; stake, including us.
        </p>

        {(phase.kind === "pick" || phase.kind === "error") && (
          <button type="button" className="btn mt-5 w-full" disabled={!asset || !symbolOk} onClick={go}>
            {!publicKey ? "Connect wallet" : asset ? `Launch ${symbol}` : "Pick an asset"}
          </button>
        )}
        {phase.kind === "preparing" && <p className="mt-5 text-sm text-ink-2">Preparing the pool and reserving a vanity address…</p>}
        {phase.kind === "running" && (
          <ol className="mt-5 space-y-2 text-sm">
            {phase.prepared.steps.map((s, i) => (
              <li key={s.step} className={i < phase.step ? "text-credit" : i === phase.step ? "text-ink" : "text-ink-2"}>
                {i < phase.step ? "✓" : i === phase.step ? "→" : "·"} {s.label}
                {i === phase.step && <span className="ml-2 text-ink-2">{phase.phase === "sign" ? "approve in your wallet" : phase.phase === "sending" ? "sending…" : phase.phase === "retry" ? "expired, asking again" : ""}</span>}
              </li>
            ))}
          </ol>
        )}
        {phase.kind === "error" && (
          <p className="mt-4 text-sm text-debit">
            {phase.message}
            {phase.prepared && <> Your launch is saved; press Launch again to continue from the step that failed.</>}
          </p>
        )}
        {phase.kind === "running" && phase.prepared.vanityPattern && <p className="mt-3 text-xs text-ink-2">Mint address pattern: {phase.prepared.vanityPattern}</p>}
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-ink-2">{k}</dt>
      <dd className="break-all font-mono text-xs">{v}</dd>
    </>
  );
}
