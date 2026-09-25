"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { adminMessage } from "@/lib/admin-auth";
import { buildDecreaseValidatorStake, buildIncreaseValidatorStake, buildUpdatePool, chunkIntoTxs, sendAll } from "@/lib/chain";
import { fmtSol, fmtCountdown, fmtUnits, LAMPORTS } from "@/lib/format";
import type { LstsResponse, EpochRun, LstView } from "@/lib/types";
import { Mark } from "./Mark";
import { TxStatus, errorMessage, type TxState } from "./TxStatus";

type Status = LstsResponse & { runs: EpochRun[]; dbPath: string; dbPresent: boolean };

export function AdminPanel({ adminWallets }: { adminWallets: string[] }) {
  const { publicKey, signMessage } = useWallet();
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wallet = publicKey?.toBase58();
  const allowed = !!wallet && adminWallets.includes(wallet);

  async function load() {
    if (!publicKey || !signMessage) return;
    try {
      const ts = Math.floor(Date.now() / 1000);
      const sig = await signMessage(new TextEncoder().encode(adminMessage(ts)));
      const r = await fetch("/api/admin/status", { headers: { "x-wallet": publicKey.toBase58(), "x-sig": bs58.encode(sig), "x-ts": String(ts) } });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      setStatus(await r.json());
      setErr(null);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  if (!wallet) return <p className="text-ink-2">Connect an admin wallet.</p>;
  if (!allowed) return <p className="text-debit">{wallet} is not in ADMIN_WALLETS.</p>;
  if (!status)
    return (
      <div>
        <p className="text-ink-2">Sign a message to prove the wallet and load pool status. Nothing is sent on-chain.</p>
        <button className="btn mt-4" onClick={load}>
          Sign in
        </button>
        {err && <p className="mt-3 text-sm text-debit">{err}</p>}
      </div>
    );

  return (
    <div className="grid gap-10">
      <div className="num grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-ink-2 sm:grid-cols-4">
        <div>
          Epoch <span className="text-ink">{status.validator.currentEpoch ?? "–"}</span>
        </div>
        <div>
          Ends in <span className="text-ink">{fmtCountdown(status.validator.epochEndsAt)}</span>
        </div>
        <div>
          Validator APY <span className="text-ink">{status.validator.totalApy.toFixed(2)}%</span>
        </div>
        <div>
          DB <span className={status.dbPresent ? "text-credit" : "text-debit"}>{status.dbPresent ? "connected" : "missing"}</span>
        </div>
      </div>

      {status.lsts.map((view) => (
        <PoolCard key={view.entry.symbol} view={view} status={status} onChanged={load} />
      ))}

      <section>
        <h2 className="mb-3 font-medium">Epoch worker</h2>
        {status.runs.length === 0 ? (
          <p className="text-sm text-ink-2">No runs recorded at {status.dbPath}. Start the worker with `pnpm ops epoch` on the ops box.</p>
        ) : (
          <table className="num w-full text-sm">
            <thead className="text-left text-ink-2">
              <tr className="border-b rule">
                <th className="py-2 font-normal">Epoch</th>
                <th className="py-2 font-normal">LST</th>
                <th className="py-2 font-normal">Started</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal">Notes</th>
              </tr>
            </thead>
            <tbody>
              {status.runs.map((r, i) => (
                <tr key={i} className="border-b rule">
                  <td className="py-2">{r.epoch}</td>
                  <td className="py-2">{r.lstSymbol}</td>
                  <td className="py-2 text-ink-2">{new Date(r.startedAt * 1000).toLocaleString("en-GB")}</td>
                  <td className={`py-2 ${r.status === "ok" ? "text-credit" : r.status === "error" ? "text-debit" : ""}`}>{r.status}</td>
                  <td className="py-2 text-ink-2">{r.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function PoolCard({ view, status, onChanged }: { view: LstView; status: Status; onChanged: () => void }) {
  const { connection } = useConnection();
  const { publicKey, signAllTransactions } = useWallet();
  const [amt, setAmt] = useState("");
  const [tx, setTx] = useState<TxState>({ kind: "idle" });
  const { entry, stats } = view;
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);

  const total = stats ? Number(stats.totalLamports) : 0;
  const target = stats ? Math.max((total * status.reserve.targetBps) / 10_000, status.reserve.minSol * LAMPORTS) : 0;
  const reserve = stats ? Number(stats.reserveAvailableLamports) : 0;
  const shortfall = target - reserve;
  const stale = stats && status.validator.currentEpoch != null && stats.lastUpdateEpoch < status.validator.currentEpoch;

  async function run(kind: "update" | "increase" | "decrease") {
    if (!publicKey || !signAllTransactions) return;
    try {
      const lamports = Math.round(Number(amt) * LAMPORTS);
      let txs: Transaction[] = [];
      if (kind === "update") {
        setTx({ kind: "busy", label: "Updating pool balances…" });
        const { phase1, phase2 } = await buildUpdatePool(connection, entry);
        txs = [...chunkIntoTxs(phase1, 4, publicKey), ...chunkIntoTxs(phase2, phase2.length, publicKey)];
      } else {
        if (!(lamports > 0)) throw new Error("Enter an amount in SOL.");
        setTx({ kind: "busy", label: kind === "increase" ? "Delegating from reserve…" : "Deactivating stake to reserve…" });
        const built =
          kind === "increase"
            ? await buildIncreaseValidatorStake(connection, entry, status.validatorVote, lamports)
            : await buildDecreaseValidatorStake(connection, entry, status.validatorVote, lamports);
        txs = chunkIntoTxs(built.instructions, built.instructions.length, publicKey);
      }
      const sigs = await sendAll(connection, txs, [], signAllTransactions);
      setTx({ kind: "done", label: kind === "update" ? "Pool updated" : kind === "increase" ? `Delegating ${amt} SOL` : `Deactivating ${amt} SOL`, sigs });
      setAmt("");
      onChanged();
    } catch (e) {
      setTx({ kind: "error", message: errorMessage(e) });
    }
  }

  const setFeeCmd = `spl-stake-pool set-fee ${entry.stakePool || "<POOL>"} sol-withdrawal ${status.fees.solWithdrawalFee.numerator} ${status.fees.solWithdrawalFee.denominator}  # signs with the manager keypair in ~/.config/solana/cli/config.yml`;

  return (
    <section className="border-t rule pt-5">
      <div className="flex items-center gap-3">
        <Mark symbol={entry.symbol} />
        <h2 className="font-medium">{entry.symbol}</h2>
        <span className="text-sm text-ink-2">{entry.status}</span>
      </div>
      {!stats ? (
        <p className="mt-3 text-sm text-ink-2">{entry.status === "draft" ? "Pool not created. Run `pnpm ops create-lst` with the vanity mint keypair." : "Stats unavailable."}</p>
      ) : (
        <>
          <div className="stat-grid num mt-4">
            <div className="stat"><div className="lbl">Total SOL</div><div className="val">{fmtSol(stats.totalLamports, 2)}</div></div>
            <div className="stat"><div className="lbl">Supply</div><div className="val">{fmtSol(stats.poolTokenSupply, 2)}</div></div>
            <div className="stat"><div className="lbl">Reserve liquid</div><div className="val">{fmtSol(reserve, 2)}</div></div>
            <div className="stat"><div className="lbl">Reserve target</div><div className={`val ${shortfall > 0 ? "text-debit" : "text-credit"}`}>{fmtSol(target, 2)}</div></div>
            <div className="stat"><div className="lbl">{shortfall > 0 ? "Shortfall" : "Excess to delegate"}</div><div className="val">{fmtSol(Math.abs(shortfall), 2)}</div></div>
            <div className="stat"><div className="lbl">Active stake</div><div className="val">{fmtSol(stats.activeStakeLamports, 2)}</div></div>
            <div className="stat"><div className="lbl">Transient</div><div className="val">{fmtSol(stats.transientStakeLamports, 2)}</div></div>
            <div className="stat"><div className="lbl">Fee tokens pending</div><div className="val">{fmtUnits(stats.pendingFeeTokens, 9)}</div></div>
            <div className="stat"><div className="lbl">Last update</div><div className={`val ${stale ? "text-debit" : ""}`}>epoch {stats.lastUpdateEpoch}{stale ? " (stale)" : ""}</div></div>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <button className="btn btn-quiet" disabled={tx.kind === "busy"} onClick={() => run("update")}>
              Update pool
            </button>
            <div>
              <label className="block text-xs text-ink-2" htmlFor={`amt-${entry.symbol}`}>SOL</label>
              <input id={`amt-${entry.symbol}`} className="field w-40" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={shortfall < 0 ? fmtSol(-shortfall, 2) : "0.00"} />
            </div>
            <button className="btn" disabled={tx.kind === "busy"} onClick={() => run("increase")}>
              Delegate to validator
            </button>
            <button className="btn btn-quiet" disabled={tx.kind === "busy"} onClick={() => run("decrease")}>
              Move to reserve
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-2">
            Delegate and move need the staker key ({stats.staker.slice(0, 6)}…); they take effect next epoch. Update is permissionless{stats.needsUpdate ? " and due now" : ""}. Fees need the manager key ({stats.manager.slice(0, 6)}…) on the CLI:
          </p>
          <pre className="mt-2 overflow-x-auto border rule bg-paper-2 p-3 font-mono text-xs">{setFeeCmd}</pre>
          <TxStatus state={tx} />
          {now > 0 && null}
        </>
      )}
    </section>
  );
}
