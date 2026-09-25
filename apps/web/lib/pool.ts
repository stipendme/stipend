import { Connection, PublicKey } from "@solana/web3.js";
import { getPoolStats as coreGetPoolStats } from "@stipend/core";
import type { LstEntry, PoolStats } from "./types";

const cache = new Map<string, { at: number; value: PoolStats | null }>();

export function serverConnection(): Connection {
  return new Connection(process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
}

/** Pool stats via core; holders is filled in by the caller (worker snapshot) or counted on-chain for small pools. */
export async function getPoolStats(connection: Connection, lst: LstEntry, holdersFromDb: number | null): Promise<PoolStats | null> {
  if (!lst.stakePool) return null;
  const hit = cache.get(lst.stakePool);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  let value: PoolStats | null = null;
  try {
    const s = await coreGetPoolStats(connection, lst);
    const avail = s.reserveLamports > s.reserveRentExempt ? s.reserveLamports - s.reserveRentExempt : 0n;
    let holders = holdersFromDb;
    // Counting holders scans every token account for the mint; only sane for Stipend-sized pools.
    if (holders == null && s.poolTokenSupply < 2_000_000n * 1_000_000_000n) {
      try {
        const accounts = await connection.getProgramAccounts(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), {
          dataSlice: { offset: 64, length: 8 },
          filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: s.mint } }],
        });
        holders = accounts.filter((a) => a.account.data.readBigUInt64LE(0) > 0n).length;
      } catch {
        holders = null;
      }
    }
    value = {
      totalLamports: s.totalLamports.toString(),
      poolTokenSupply: s.poolTokenSupply.toString(),
      reserveLamports: s.reserveLamports.toString(),
      reserveAvailableLamports: avail.toString(),
      activeStakeLamports: s.activeStakeLamports.toString(),
      transientStakeLamports: s.transientLamports.toString(),
      lastUpdateEpoch: s.lastUpdateEpoch,
      needsUpdate: s.needsUpdate,
      pendingFeeTokens: s.managerFeeTokens.toString(),
      holders,
      staker: s.staker,
      manager: s.manager,
    };
  } catch {
    value = null;
  }
  cache.set(lst.stakePool, { at: Date.now(), value });
  return value;
}
