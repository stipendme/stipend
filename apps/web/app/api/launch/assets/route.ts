import { NextResponse } from "next/server";
import { loadRegistry, launchAssets, launchQuote } from "@/lib/launch-server";
export const dynamic = "force-dynamic";
export async function GET() {
  const reg = loadRegistry();
  const [assets, quote] = await Promise.all([launchAssets(reg), launchQuote(reg)]);
  return NextResponse.json({ assets, quote, symbols: reg.lsts.map((l) => l.symbol) });
}
