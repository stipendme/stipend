import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface HolderSnapshot {
  slot: number;
  balances: Map<string, bigint>;
  total: bigint;
  accounts: number;
}

/**
 * All holders of a classic SPL token mint (stake pool LSTs are classic SPL), grouped by owner.
 * excludeOwners are dropped (fee account owner, treasury, AMM pools, ...). Zero balances are dropped.
 */
export async function snapshotHolders(connection: Connection, mint: PublicKey, excludeOwners: Iterable<string> = []): Promise<HolderSnapshot> {
  const exclude = new Set(Array.from(excludeOwners));
  const slot = await connection.getSlot("confirmed");
  const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint.toBase58() } }],
    dataSlice: { offset: 32, length: 40 }, // owner(32) + amount(8)
  });
  const balances = new Map<string, bigint>();
  let total = 0n;
  for (const { account } of accounts) {
    const owner = new PublicKey(account.data.subarray(0, 32)).toBase58();
    const amount = account.data.readBigUInt64LE(32);
    if (amount === 0n || exclude.has(owner)) continue;
    balances.set(owner, (balances.get(owner) ?? 0n) + amount);
    total += amount;
  }
  return { slot, balances, total, accounts: accounts.length };
}
