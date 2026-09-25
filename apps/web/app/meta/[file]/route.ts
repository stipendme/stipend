import { NextResponse } from "next/server";
import { MARK_VERSION } from "@/lib/mark-version";
import { loadRegistry, findLst } from "@/lib/registry";

export const dynamic = "force-dynamic";

/** Token metadata JSON for an LST mint: /meta/nvdaSOL.json */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const symbol = file.replace(/\.json$/i, "");
  const registry = loadRegistry();
  const lst = findLst(registry, symbol);
  if (!lst) return NextResponse.json({ error: "Unknown LST" }, { status: 404 });
  // Public origin. Never derive it from req.url: behind nginx that is the app's local address (https://localhost:3000),
  // and wallets cache metadata on first sight. PUBLIC_ORIGIN overrides for staging.
  const origin = (process.env.PUBLIC_ORIGIN?.trim() || `https://${registry.brand.domain}`).replace(/\/$/, "");
  return NextResponse.json(
    {
      name: lst.name,
      symbol: lst.symbol,
      description: `${lst.symbol} is a Stipend liquid staking token. It stays 1:1 with SOL; its staking yield is paid to holders in ${lst.asset.symbol} (${lst.asset.name}) every epoch.`,
      image: `${origin}/tokens/${lst.symbol}.png?v=${MARK_VERSION}`,
      external_url: `https://${registry.brand.domain}/lst/${lst.symbol}`,
      properties: { files: [{ uri: `${origin}/tokens/${lst.symbol}.png?v=${MARK_VERSION}`, type: "image/png" }, { uri: `${origin}/tokens/${lst.symbol}.svg?v=${MARK_VERSION}`, type: "image/svg+xml" }], category: "image" },
      attributes: [
        { trait_type: "pays", value: lst.asset.symbol },
        { trait_type: "validator", value: registry.validator.name },
      ],
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
