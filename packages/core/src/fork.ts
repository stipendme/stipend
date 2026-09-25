/**
 * Surfpool (surfnet) helpers. Only used when the RPC answers surfnet_getSurfnetInfo, i.e. never on mainnet.
 * The epoch worker uses these to stand in for the one thing a fork cannot do for real: a Jupiter fill.
 */
import { Connection, PublicKey } from "@solana/web3.js";

let cached: Map<string, boolean> = new Map();

async function rpc<T = unknown>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}

export async function isSurfnet(connection: Connection): Promise<boolean> {
  const url = connection.rpcEndpoint;
  if (cached.has(url)) return cached.get(url)!;
  let ok = false;
  try { await rpc(url, "surfnet_getSurfnetInfo", []); ok = true; } catch { ok = false; }
  cached.set(url, ok);
  return ok;
}

export const surfnet = {
  setAccount: (c: Connection, pubkey: PublicKey | string, patch: { lamports?: number; owner?: string; data?: number[] | string; executable?: boolean }) =>
    rpc(c.rpcEndpoint, "surfnet_setAccount", [String(pubkey), patch]),
  /** Sets (not adds) the token balance of owner's ATA for mint. tokenProgram is required for Token-2022 mints. */
  setTokenAccount: (c: Connection, owner: PublicKey | string, mint: PublicKey | string, amount: bigint, tokenProgram?: PublicKey | string) =>
    rpc(c.rpcEndpoint, "surfnet_setTokenAccount", tokenProgram ? [String(owner), String(mint), { amount: Number(amount), state: "initialized" }, String(tokenProgram)] : [String(owner), String(mint), { amount: Number(amount), state: "initialized" }]),
  timeTravel: (c: Connection, to: { absoluteEpoch?: number; absoluteSlot?: number; absoluteTimestamp?: number }) =>
    rpc<{ epoch: number; absoluteSlot: number }>(c.rpcEndpoint, "surfnet_timeTravel", [to]),
  /** Add lamports to any account (e.g. a stake pool reserve, to stand in for epoch rewards). */
  addLamports: async (c: Connection, pubkey: PublicKey | string, lamports: bigint) => {
    const bal = await c.getBalance(new PublicKey(String(pubkey)));
    return rpc(c.rpcEndpoint, "surfnet_setAccount", [String(pubkey), { lamports: Number(BigInt(bal) + lamports) }]);
  },
};
