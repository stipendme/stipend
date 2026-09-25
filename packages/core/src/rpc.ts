import { Connection, Keypair } from "@solana/web3.js";
import { createSolanaRpc, createSolanaRpcSubscriptions, createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";
import { readFileSync } from "node:fs";

export const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export function rpcUrl(url?: string): string {
  return url ?? process.env.RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? DEFAULT_RPC;
}

export function makeConnection(url?: string): Connection {
  return new Connection(rpcUrl(url), { commitment: "confirmed" });
}

export function makeKitRpc(url?: string) {
  const http = rpcUrl(url);
  const ws = http.replace(/^http/, "ws");
  return { rpc: createSolanaRpc(http), rpcSubscriptions: createSolanaRpcSubscriptions(ws) };
}

export function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export async function kitSignerFromKeypair(kp: Keypair): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(kp.secretKey);
}
