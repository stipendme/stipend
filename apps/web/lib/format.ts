export const LAMPORTS = 1_000_000_000;

export function lamportsToSol(l: string | number | bigint): number {
  if (typeof l === "number") return l / LAMPORTS;
  return Number(BigInt(l)) / LAMPORTS;
}

export function fmtSol(l: string | number | bigint, digits = 2): string {
  return lamportsToSol(l).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtUnits(amount: string | number | bigint, decimals: number, maxDigits = 4): string {
  const n = Number(BigInt(amount)) / 10 ** decimals;
  return fmtNum(n, maxDigits);
}

export function fmtNum(n: number, maxDigits = 4): string {
  if (!Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : maxDigits;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtPct(n: number, digits = 2): string {
  return `${n.toFixed(digits)}%`;
}

export function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 100 ? 0 : 2 });
}

export function shortAddr(a: string, n = 4): string {
  return a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

export function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtCountdown(unixSeconds: number | null): string {
  if (!unixSeconds) return "–";
  const s = Math.max(0, unixSeconds - Math.floor(Date.now() / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Asset quantities in the ledger: fixed two decimals from 1 up, so a column reads evenly; more precision below 1. */
export function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs >= 0.01) return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 5 });
}
