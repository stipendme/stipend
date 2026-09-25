import nacl from "tweetnacl";
import bs58 from "bs58";

export function adminWallets(): string[] {
  return (process.env.ADMIN_WALLETS ?? process.env.NEXT_PUBLIC_ADMIN_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function adminMessage(ts: number): string {
  return `Stipend admin\nSigned at ${ts}`;
}

/** Verifies the x-wallet / x-sig / x-ts headers produced by the admin page. 5 minute window. */
export function verifyAdmin(headers: Headers): { ok: true; wallet: string } | { ok: false; reason: string } {
  const wallet = headers.get("x-wallet") ?? "";
  const sig = headers.get("x-sig") ?? "";
  const ts = Number(headers.get("x-ts") ?? "0");
  if (!wallet || !sig || !ts) return { ok: false, reason: "missing auth headers" };
  if (!adminWallets().includes(wallet)) return { ok: false, reason: "wallet is not an admin" };
  if (Math.abs(Date.now() / 1000 - ts) > 300) return { ok: false, reason: "signature expired" };
  try {
    const ok = nacl.sign.detached.verify(new TextEncoder().encode(adminMessage(ts)), bs58.decode(sig), bs58.decode(wallet));
    return ok ? { ok: true, wallet } : { ok: false, reason: "bad signature" };
  } catch {
    return { ok: false, reason: "bad signature" };
  }
}
