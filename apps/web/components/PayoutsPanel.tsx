"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { fetchClaims } from "@/lib/api-client";
import { fmtUnits, fmtDate } from "@/lib/format";
import type { LstEntry } from "@/lib/types";
import { OpenAssetAccount } from "./OpenAssetAccount";

/** The worker sends the asset to holders each epoch; this shows what this wallet has received. */
export function PayoutsPanel({ entry }: { entry: LstEntry }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58();
  const q = useQuery({ queryKey: ["claims", wallet], queryFn: () => fetchClaims(wallet!), enabled: !!wallet });
  if (!wallet) return <p className="text-sm text-ink-2">Connect a wallet to see what it has been paid.</p>;
  if (q.isLoading) return <p className="text-sm text-ink-2">Checking payouts…</p>;
  const led = q.data?.ledger.find((l) => l.lstSymbol === entry.symbol);
  const payouts = (q.data?.payouts ?? []).filter((p) => p.lstSymbol === entry.symbol).slice(0, 8);
  const pending = led ? BigInt(led.owed) - BigInt(led.paid) : 0n;
  return (
    <div>
      <div className="num flex items-baseline justify-between border-y rule py-3">
        <span className="text-ink-2">Paid to this wallet</span>
        <span className="text-[1.375rem] font-semibold text-credit">
          {fmtUnits(led?.paid ?? "0", entry.asset.decimals)} {entry.asset.symbol}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-2">
        {entry.asset.symbol} lands in your wallet every epoch. Nothing to claim.
        {pending > 0n && ` ${fmtUnits(pending, entry.asset.decimals)} ${entry.asset.symbol} is carried until it clears the minimum payout.`}
      </p>
      <OpenAssetAccount entries={[entry]} compact />
      {payouts.length > 0 && (
        <ul className="num mt-3 divide-y divide-[color:var(--color-rule-2)] text-sm">
          {payouts.map((p) => (
            <li key={`${p.epoch}-${p.ts}`} className="flex items-center justify-between py-1.5">
              <span className="text-ink-2">
                Epoch {p.epoch}, {fmtDate(p.ts)}
              </span>
              {p.signature ? (
                <a className="underline decoration-rule underline-offset-2" href={`https://solscan.io/tx/${p.signature}`} target="_blank" rel="noreferrer">
                  {fmtUnits(p.amount, entry.asset.decimals)} {entry.asset.symbol}
                </a>
              ) : (
                <span>
                  {fmtUnits(p.amount, entry.asset.decimals)} {entry.asset.symbol}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
