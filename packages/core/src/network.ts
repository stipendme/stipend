import { Connection } from "@solana/web3.js";

export type Network = "mainnet-beta" | "testnet" | "devnet" | "surfnet" | "unknown";

const GENESIS: Record<string, Network> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "mainnet-beta",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "testnet",
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG": "devnet",
};

const cache = new Map<string, Network>();

/** Which cluster a connection points at, from its genesis hash. A Surfpool fork of mainnet reports mainnet's hash, so surfnet is detected separately. */
export async function getNetwork(conn: Connection): Promise<Network> {
  const url = conn.rpcEndpoint;
  const hit = cache.get(url);
  if (hit) return hit;
  let net: Network = "unknown";
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "surfnet_getSurfnetInfo", params: [] }) });
    const j = (await r.json()) as { result?: unknown };
    if (j.result) net = "surfnet";
  } catch { /* not a surfnet */ }
  if (net === "unknown") {
    try { net = GENESIS[await conn.getGenesisHash()] ?? "unknown"; } catch { net = "unknown"; }
  }
  cache.set(url, net);
  return net;
}

export const isMainnet = async (conn: Connection) => (await getNetwork(conn)) === "mainnet-beta";
