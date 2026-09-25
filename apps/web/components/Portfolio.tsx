"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { fetchClaims, fetchLsts } from "@/lib/api-client";
import { fmtNum, fmtUnits, fmtDate } from "@/lib/format";
import { LstLogo } from "./LstLogo";
import { OpenAssetAccount } from "./OpenAssetAccount";

export function Portfolio() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58();
  const lsts = useQuery({ queryKey: ["lsts"], queryFn: fetchLsts });
  const claims = useQuery({ queryKey: ["claims", wallet], queryFn: () => fetchClaims(wallet!), enabled: !!wallet });
  const [bals, setBals] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!publicKey || !lsts.data) return;
    let live = true;
    (async () => {
      const out: Record<string, number> = {};
      for (const { entry } of lsts.data.lsts) {
        if (!entry.mint) continue;
        try {
          const b = await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(entry.mint), publicKey));
          out[entry.symbol] = Number(b.value.amount) / 1e9;
        } catch {
          out[entry.symbol] = 0;
        }
      }
      if (live) setBals(out);
    })();
    return () => {
      live = false;
    };
  }, [publicKey, lsts.data, connection]);

  if (!wallet) return <p className="text-ink-2">Connect a wallet to see its Stipend positions and what they have been paid.</p>;
  if (!lsts.data) return <p className="text-ink-2">Loading…</p>;

  const held = lsts.data.lsts.filter((l) => (bals[l.entry.symbol] ?? 0) > 0);
  const ledger = new Map((claims.data?.ledger ?? []).map((r) => [r.lstSymbol, r]));
  const totalSol = held.reduce((a, l) => a + (bals[l.entry.symbol] ?? 0), 0);
  const payouts = claims.data?.payouts ?? [];

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
      <div>
        <div className="num mb-6">
          <div className="text-sm text-ink-2">Staked through Stipend</div>
          <div className="text-[2.5rem] font-semibold leading-none">{fmtNum(totalSol, 3)} SOL</div>
        </div>
        {held.length === 0 ? (
          <p className="text-ink-2">
            This wallet holds no Stipend LSTs.{" "}
            <Link href="/" className="underline decoration-rule underline-offset-2">
              Pick an asset to start.
            </Link>
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[560px] text-[0.9375rem]">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th className="r">Balance</th>
                    <th className="r">Pays annually, estimate</th>
                    <th className="r">Earned to date</th>
                    <th className="r">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {held.map(({ entry, yield: y }) => {
                    const bal = bals[entry.symbol] ?? 0;
                    const led = ledger.get(entry.symbol);
                    return (
                      <tr key={entry.symbol}>
                        <td>
                          <Link href={`/lst/${entry.symbol}`} className="flex items-center gap-3">
                            <LstLogo symbol={entry.symbol} size={24} />
                            <span>
                              <span className="font-medium">{entry.symbol}</span>
                              <span className="ml-2 text-sm text-ink-2">pays {entry.asset.symbol}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="r">{fmtNum(bal, 4)}</td>
                        <td className="r font-medium text-credit">
                          {y.assetPer100SolYear == null ? "–" : `~${fmtNum((y.assetPer100SolYear * bal) / 100, 5)} ${entry.asset.symbol}`}
                        </td>
                        <td className="r">{led ? `${fmtUnits(led.owed, entry.asset.decimals)} ${entry.asset.symbol}` : "–"}</td>
                        <td className="r text-ink-2">{led ? fmtUnits(BigInt(led.claimed) + BigInt(led.paid), entry.asset.decimals) : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-ink-2">~ marks an estimate at current SOL and asset prices. Payouts land in this wallet every epoch.</p>
            <OpenAssetAccount entries={held.map((l) => l.entry)} />
          </>
        )}
      </div>
      <aside>
        <div className="border rule p-5">
          <h2 className="mb-3 font-medium">Recent payouts</h2>
          {payouts.length === 0 ? (
            <p className="text-sm text-ink-2">Nothing yet. The first payout lands at the end of the first full epoch you hold an LST.</p>
          ) : (
            <ul className="num divide-y divide-[color:var(--color-rule-2)] text-sm">
              {payouts.slice(0, 12).map((p) => {
                const lst = lsts.data.lsts.find((l) => l.entry.symbol === p.lstSymbol);
                const amount = lst ? `${fmtUnits(p.amount, lst.entry.asset.decimals)} ${lst.entry.asset.symbol}` : p.amount;
                return (
                  <li key={`${p.lstSymbol}-${p.epoch}-${p.ts}`} className="flex items-center justify-between py-1.5">
                    <span className="text-ink-2">
                      {p.lstSymbol}, epoch {p.epoch}, {fmtDate(p.ts)}
                    </span>
                    {p.signature ? (
                      <a className="underline decoration-rule underline-offset-2" href={`https://solscan.io/tx/${p.signature}`} target="_blank" rel="noreferrer">
                        {amount}
                      </a>
                    ) : (
                      <span>{amount}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
