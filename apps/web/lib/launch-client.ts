// Browser side of a launch: the API prepares and co-signs, the wallet signs as fee payer, the API submits.
import { Transaction } from "@solana/web3.js";

export interface LaunchAsset { mint: string; symbol: string; name: string; group: "stocks" | "metals" | "majors" | "other"; logo?: string; liquidityUsd?: number; ticker: string; taken?: string }
export interface LaunchMenu { assets: LaunchAsset[]; quote: { enabled: boolean; creatorFeeBps: number; platformFeeBps: number; costs: Record<string, string> }; symbols: string[] }
export interface Prepared { id: string; steps: { step: string; label: string }[]; addresses: Record<string, string>; costs: Record<string, string>; symbol: string; vanityPattern?: string }
export interface StepTx { id: string; step: number; total: number; label: string; tx: string; lastValidBlockHeight: number; done: boolean; signatures: string[] }
export interface Submitted { step: number; total: number; signature: string; done: boolean; addresses?: Record<string, string>; signatures: string[] }

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { const e = new Error(j.error ?? r.statusText) as Error & { expired?: boolean; status?: number }; e.expired = !!j.expired; e.status = r.status; throw e; }
  return j as T;
}
export const fetchLaunchMenu = async (): Promise<LaunchMenu> => { const r = await fetch("/api/launch/assets"); if (!r.ok) throw new Error("Could not load the asset list"); return r.json(); };
export const prepare = (b: { assetMint: string; symbol: string; creator: string }) => post<Prepared>("/api/launch/prepare", b);
export const refresh = (id: string) => post<StepTx>("/api/launch/refresh", { id });
export interface AllStepsTx { id: string; step: number; total: number; done: boolean; signatures: string[]; lastValidBlockHeight: number; txs: { step: number; label: string; tx: string }[] }
export const refreshAll = (id: string) => post<AllStepsTx>("/api/launch/refresh", { id, all: true });
export const submit = (id: string, tx: string) => post<Submitted>("/api/launch/submit", { id, tx });

export type StepEvent = { step: number; total: number; label: string; phase: "sign" | "sending" | "confirmed" | "retry"; signature?: string };

/**
 * One wallet prompt for the whole launch when the wallet supports signAllTransactions: every remaining step is fetched with one
 * fresh blockhash and backend signatures, signed together, then submitted in order. If a later step expires before it is sent
 * (slow network, or the user sat on the prompt), the remaining steps are fetched and signed again. Wallets without
 * signAllTransactions fall back to one prompt per step.
 */
export async function runLaunch(
  id: string,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  onStep: (s: StepEvent) => void,
  signAllTransactions?: (txs: Transaction[]) => Promise<Transaction[]>,
): Promise<Submitted> {
  if (signAllTransactions) {
    for (;;) {
      const all = await refreshAll(id);
      if (all.done) return { step: all.step, total: all.total, signature: "", done: true, signatures: all.signatures };
      onStep({ step: all.step, total: all.total, label: `Approve ${all.txs.length} transaction${all.txs.length === 1 ? "" : "s"} in your wallet`, phase: "sign" });
      const signed = await signAllTransactions(all.txs.map((t) => Transaction.from(Buffer.from(t.tx, "base64"))));
      let expired = false;
      for (let i = 0; i < signed.length; i++) {
        const meta = all.txs[i];
        onStep({ step: meta.step, total: all.total, label: meta.label, phase: "sending" });
        let res: Submitted;
        try {
          res = await submit(id, Buffer.from(signed[i].serialize({ requireAllSignatures: true, verifySignatures: false })).toString("base64"));
        } catch (e) {
          if ((e as { expired?: boolean }).expired) { onStep({ step: meta.step, total: all.total, label: meta.label, phase: "retry" }); expired = true; break; }
          throw e;
        }
        onStep({ step: meta.step, total: all.total, label: meta.label, phase: "confirmed", signature: res.signature });
        if (res.done) return res;
      }
      if (!expired) { const fin = await refreshAll(id); if (fin.done) return { step: fin.step, total: fin.total, signature: "", done: true, signatures: fin.signatures }; }
    }
  }
  // per-step fallback
  for (;;) {
    const cur = await refresh(id);
    if (cur.done) return { step: cur.step, total: cur.total, signature: "", done: true, signatures: cur.signatures };
    onStep({ step: cur.step, total: cur.total, label: cur.label, phase: "sign" });
    const tx = Transaction.from(Buffer.from(cur.tx, "base64"));
    const signed = await signTransaction(tx);
    onStep({ step: cur.step, total: cur.total, label: cur.label, phase: "sending" });
    let res: Submitted;
    try {
      res = await submit(id, Buffer.from(signed.serialize({ requireAllSignatures: true, verifySignatures: false })).toString("base64"));
    } catch (e) {
      if ((e as { expired?: boolean }).expired) { onStep({ step: cur.step, total: cur.total, label: cur.label, phase: "retry" }); continue; }
      throw e;
    }
    onStep({ step: cur.step, total: cur.total, label: cur.label, phase: "confirmed", signature: res.signature });
    if (res.done) return res;
  }
}
