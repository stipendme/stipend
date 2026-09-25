"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useEffect, useState } from "react";
import { FaucetButton, NetworkBadge } from "./Faucet";

export function Header({ brand, adminWallets }: { brand: { name: string; tagline: string }; adminWallets: string[] }) {
  const path = usePathname();
  const { publicKey } = useWallet();
  const isAdmin = !!publicKey && adminWallets.includes(publicKey.toBase58());
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`border-b-2 pb-0.5 ${path === href || (href !== "/" && path.startsWith(href)) ? "border-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
    >
      {label}
    </Link>
  );

  return (
    <header className="mx-auto flex w-full max-w-[1040px] flex-wrap items-center gap-x-6 gap-y-3 px-5 pt-6 sm:px-8">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-[1.375rem] font-semibold tracking-tight">
          {brand.name}
        </Link>
        <NetworkBadge />
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2 sm:order-2 sm:gap-3">
        <FaucetButton compact />
        <ThemeToggle />
        {mounted ? <WalletMultiButton /> : <span className="btn" aria-hidden />}
      </div>
      <nav className="order-last flex basis-full flex-wrap items-center gap-x-4 gap-y-1 text-[0.9375rem] sm:order-1 sm:basis-auto sm:gap-5">
        {link("/", "Pools")}
        {link("/calculator", "Calculator")}
        {link("/stats", "Stats")}
        {link("/launch", "Launch")}
        {link("/docs", "Docs")}
        {link("/portfolio", "Portfolio")}
        {isAdmin && link("/admin", "Admin")}
      </nav>
    </header>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  if (dark === null) return null;
  return (
    <button
      type="button"
      className="btn btn-quiet h-10 w-10 px-0"
      aria-label={dark ? "Switch to light" : "Switch to dark"}
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("stipend-theme", next ? "dark" : "light");
        } catch {}
        setDark(next);
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
      </svg>
    </button>
  );
}
