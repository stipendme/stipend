import { TestnetBanner } from "@/components/Faucet";
import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { loadRegistry } from "@/lib/registry";

const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Stipend",
  description: "Stake SOL. Get paid in stocks. Hold an LST, receive its asset every epoch.",
};

const themeScript = `(function(){try{var t=localStorage.getItem('stipend-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const registry = loadRegistry();
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers rpcUrl={process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.mainnet-beta.solana.com"}>
          <Header brand={registry.brand} adminWallets={(process.env.NEXT_PUBLIC_ADMIN_WALLETS ?? process.env.ADMIN_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean)} />
          <TestnetBanner />
          <main className="mx-auto w-full max-w-[1040px] px-5 pb-24 pt-8 sm:px-8">{children}</main>
          <footer className="mx-auto w-full max-w-[1040px] border-t rule px-5 py-8 text-sm text-ink-2 sm:px-8">
            <p>
              {registry.brand.name} pools stake to {registry.validator.name}. Every LST stays 1:1 with SOL and its yield is paid to holders in
              the asset they chose, every epoch.
            </p>
            <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              <Link href="/docs" className="underline decoration-rule underline-offset-2">
                How it works
              </Link>
              <Link href="/stats" className="underline decoration-rule underline-offset-2">
                Stats
              </Link>
              <Link href="/calculator" className="underline decoration-rule underline-offset-2">
                Calculator
              </Link>
            </p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
