import { NextResponse } from "next/server";
import { buildTvlResponse } from "@/lib/tvl";

export const dynamic = "force-dynamic";

/** Current TVL for DefiLlama and anyone else: { totalSol, totalUsd, byAsset: [{ symbol, assetSymbol, sol, usd }], updatedAt, source }. */
export async function GET() {
  const data = await buildTvlResponse();
  return NextResponse.json(data, { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
}
