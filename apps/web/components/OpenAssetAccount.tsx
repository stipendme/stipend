"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { buildOpenAssetAccount, hasAssetAccount, tokenAccountRent } from "@/lib/chain";
import { LAMPORTS } from "@/lib/format";
import type { LstEntry } from "@/lib/types";
import { TxStatus, errorMessage, type TxState } from "./TxStatus";

/**
 * For wallets that hold an LST but have no token account for its payout asset (they minted on Jupiter, or were sent the
 * LST). Opening it yourself, once, means the next epoch pays straight in and nothing waits on the platform's rent budget.
 */
export function OpenAssetAccount({ entries, compact = false }: { entries: LstEntry[]; compact?: boolean }) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [missing, setMissing] = useState<LstEntry[]>([]);
  const [rent, setRent] = useState<number | null>(null);
  const [state, setState] = useState<TxState>({ kind: "idle" });

  useEffect(() => {
    if (!publicKey) {
      setMissing([]);
      return;
    }
    let live = true;
    (async () => {
      const out: LstEntry[] = [];
      for (const e of entries) {
        if (!e.asset.mint) continue;
        try {
          if (!(await hasAssetAccount(connection, e, publicKey))) out.push(e);
        } catch {
          /* unknown: don't prompt */
        }
      }
      if (!live) return;
      setMissing(out);
      if (out.length) setRent(await tokenAccountRent(connection));
    })();
    return () => {
      live = false;
    };
  }, [publicKey, connection, entries, state]);

  if (!publicKey || missing.length === 0) return null;
  const symbols = missing.map((e) => e.asset.symbol).join(", ");
  const rentSol = rent == null ? null : (rent * missing.length) / LAMPORTS;

  async function open() {
    if (!publicKey || !signTransaction) return;
    try {
      setState({ kind: "busy", label: `Opening ${symbols} account…` });
      const tx = new Transaction();
      tx.feePayer = publicKey;
      for (const e of missing) tx.add(buildOpenAssetAccount(e, publicKey));
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      setState({ kind: "done", label: `Opened ${symbols} account`, sigs: [sig] });
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e) });
    }
  }

  return (
    <div className={compact ? "mt-4 border-t rule pt-3" : "mt-6 border rule p-4"}>
      <p className="text-sm text-ink-2">
        This wallet has no {symbols} token account yet. Open it now{rentSol != null ? ` (${rentSol.toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL rent, once)` : ""} and the
        next epoch pays straight into it.
      </p>
      <button type="button" className="btn btn-quiet mt-3" disabled={state.kind === "busy"} onClick={open}>
        Open {symbols} account
      </button>
      <TxStatus state={state} />
    </div>
  );
}
