"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { buildDepositSol, buildWithdrawSol, chunkIntoTxs, sendAll, hasAssetAccount, tokenAccountRent } from "@/lib/chain";
import { fmtSol, LAMPORTS } from "@/lib/format";
import type { LstView, Fee } from "@/lib/types";
import { TxStatus, errorMessage, type TxState } from "./TxStatus";
import { FaucetButton } from "./Faucet";

export function MintRedeem({ view, withdrawalFee }: { view: LstView; withdrawalFee: Fee }) {
  const { connection } = useConnection();
  const { publicKey, signAllTransactions } = useWallet();
  const { setVisible } = useWalletModal();
  const [tab, setTab] = useState<"mint" | "redeem">("mint");
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<TxState>({ kind: "idle" });
  const [solBal, setSolBal] = useState<number | null>(null);
  const [lstBal, setLstBal] = useState<number | null>(null);
  const [needsAssetAccount, setNeedsAssetAccount] = useState(false);
  const [rentLamports, setRentLamports] = useState<number | null>(null);
  const { entry, stats } = view;
  const draft = entry.status === "draft" || !entry.stakePool;
  const feePct = (withdrawalFee.numerator / withdrawalFee.denominator) * 100;

  useEffect(() => {
    if (!publicKey) {
      setSolBal(null);
      setLstBal(null);
      setNeedsAssetAccount(false);
      return;
    }
    let live = true;
    (async () => {
      const sol = await connection.getBalance(publicKey);
      if (live) setSolBal(sol / LAMPORTS);
      try {
        const has = await hasAssetAccount(connection, entry, publicKey);
        if (live) setNeedsAssetAccount(!has);
        if (!has) {
          const rent = await tokenAccountRent(connection);
          if (live) setRentLamports(rent);
        }
      } catch {
        if (live) setNeedsAssetAccount(false);
      }
      if (!draft) {
        try {
          const ata = getAssociatedTokenAddressSync(new PublicKey(entry.mint), publicKey);
          const b = await connection.getTokenAccountBalance(ata);
          if (live) setLstBal(Number(b.value.amount) / LAMPORTS);
        } catch {
          if (live) setLstBal(0);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [publicKey, connection, entry, draft, state]);

  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0;
  const reserveAvail = stats ? Number(stats.reserveAvailableLamports) / LAMPORTS : 0;

  async function run() {
    if (!publicKey || !signAllTransactions) return setVisible(true);
    try {
      setState({ kind: "busy", label: tab === "mint" ? `Minting ${entry.symbol}…` : "Redeeming SOL…" });
      const lamports = Math.round(n * LAMPORTS);
      const built = tab === "mint" ? await buildDepositSol(connection, entry, publicKey, lamports, { openAssetAccount: needsAssetAccount }) : await buildWithdrawSol(connection, entry, publicKey, lamports);
      const txs = chunkIntoTxs(built.instructions, built.instructions.length, publicKey);
      const sigs = await sendAll(connection, txs, built.signers, signAllTransactions);
      setState({ kind: "done", label: tab === "mint" ? `Minted ${amount} ${entry.symbol}` : `Redeemed ${amount} SOL`, sigs });
      setAmount("");
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e) });
    }
  }

  return (
    <div>
      <div role="tablist" className="flex border-b rule">
        <button role="tab" aria-selected={tab === "mint"} className="tab" onClick={() => setTab("mint")}>
          Mint
        </button>
        <button role="tab" aria-selected={tab === "redeem"} className="tab" onClick={() => setTab("redeem")}>
          Redeem
        </button>
      </div>
      <div className="mt-5">
        <div className="flex items-center justify-between gap-2">
          <label className="block text-sm text-ink-2" htmlFor="amt">
            {tab === "mint" ? "SOL to stake" : `${entry.symbol} to redeem`}
          </label>
          {tab === "mint" && <FaucetButton compact />}
        </div>
        <div className="mt-1 flex gap-2">
          <input
            id="amt"
            className="field"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            disabled={draft}
          />
          <button
            type="button"
            className="btn btn-quiet"
            disabled={draft || (tab === "mint" ? solBal == null : lstBal == null)}
            onClick={() => setAmount(tab === "mint" ? Math.max(0, (solBal ?? 0) - 0.01).toFixed(4) : (lstBal ?? 0).toFixed(9))}
          >
            Max
          </button>
        </div>
        <dl className="num mt-4 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm text-ink-2">
          {tab === "mint" ? (
            <>
              <dt>You receive</dt>
              <dd className="text-right text-ink">{valid ? `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${entry.symbol}` : "–"}</dd>
              <dt>Rate</dt>
              <dd className="text-right text-ink">1 SOL = 1 {entry.symbol}, always</dd>
              {publicKey && needsAssetAccount && (
                <>
                  <dt>{entry.asset.symbol} account</dt>
                  <dd className="text-right text-ink">{rentLamports == null ? "opened with this mint" : `${(rentLamports / LAMPORTS).toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL rent, once`}</dd>
                </>
              )}
              <dt>Wallet</dt>
              <dd className="text-right">{solBal == null ? "–" : `${solBal.toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL`}</dd>
            </>
          ) : (
            <>
              <dt>You receive</dt>
              <dd className="text-right text-ink">{valid ? `${(n * (1 - feePct / 100)).toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL, after the ${feePct}% withdrawal fee` : "–"}</dd>
              <dt>Available now</dt>
              <dd className={`text-right ${valid && n > reserveAvail ? "text-debit" : "text-ink"}`}>{stats ? `${fmtSol(stats.reserveAvailableLamports)} SOL in reserve` : "–"}</dd>
              <dt>Wallet</dt>
              <dd className="text-right">{lstBal == null ? "–" : `${lstBal.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${entry.symbol}`}</dd>
            </>
          )}
        </dl>
        {tab === "redeem" && valid && n > reserveAvail && (
          <p className="mt-3 text-sm text-debit">
            Only {fmtSol(stats?.reserveAvailableLamports ?? 0)} SOL is liquid right now. Redeem less, or wait for the next rebalance, or sell {entry.symbol} on a DEX.
          </p>
        )}
        <button type="button" className="btn mt-5 w-full" disabled={draft || (publicKey ? !valid || state.kind === "busy" : false)} onClick={run}>
          {draft ? "Not open yet" : !publicKey ? "Connect wallet" : tab === "mint" ? `Mint ${entry.symbol}` : "Redeem SOL"}
        </button>
        <TxStatus state={state} />
      </div>
    </div>
  );
}
