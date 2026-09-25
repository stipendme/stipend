"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

const NETWORK = process.env.NEXT_PUBLIC_NETWORK ?? "mainnet-beta";
export const isTestNetwork = NETWORK !== "mainnet-beta";

/** "Get test SOL" button. Renders nothing on mainnet. */
export function FaucetButton({ compact = false }: { compact?: boolean }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "ok"; text: string } | { kind: "err"; text: string }>({ kind: "idle" });
  if (!isTestNetwork) return null;
  const run = async () => {
    if (!publicKey) { setVisible(true); return; }
    setState({ kind: "busy" });
    try {
      const r = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: publicKey.toBase58() }) });
      const j = (await r.json()) as { ok?: boolean; sol?: number; error?: string; method?: string };
      if (!r.ok || !j.ok) setState({ kind: "err", text: j.error ?? `faucet error ${r.status}` });
      else setState({ kind: "ok", text: `Sent ${j.sol} test SOL` });
    } catch (e) { setState({ kind: "err", text: (e as Error).message }); }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={compact ? "btn btn-quiet" : "btn"} onClick={run} disabled={state.kind === "busy"}>
        {state.kind === "busy" ? "Requesting…" : "Get test SOL"}
      </button>
      {state.kind === "ok" && <span className="text-[0.8125rem] text-credit">{state.text}</span>}
      {state.kind === "err" && <span className="text-[0.8125rem] text-debit">{state.text}</span>}
    </span>
  );
}

export function NetworkBadge() {
  if (!isTestNetwork) return null;
  return (
    <span className="rounded-sm border border-rule px-1.5 py-0.5 text-[0.75rem] uppercase tracking-wide text-ink-2" title="Test network: tokens have no value">
      {NETWORK}
    </span>
  );
}

export function TestnetBanner() {
  if (!isTestNetwork) return null;
  return (
    <div className="mx-auto w-full max-w-[1040px] px-5 sm:px-8">
      <p className="mt-4 rounded-sm border border-rule bg-paper-2 px-3 py-2 text-[0.875rem] text-ink-2">
        Test network ({NETWORK}). Tokens here have no value. In Phantom: Settings → Developer settings → Testnet mode, then use the “Get test SOL” button.
      </p>
    </div>
  );
}
