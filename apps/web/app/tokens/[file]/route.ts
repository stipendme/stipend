import fs from "node:fs";
import { MARK_VERSION } from "@/lib/mark-version";
import path from "node:path";
import { findRepoRoot } from "@stipend/core";
import { loadRegistry, findLst } from "@/lib/registry";
import { fetchIcon, composeMark, fallbackMark } from "@/lib/logo-compose.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /tokens/<symbol>.png|svg: the LST mark used in the site and in token metadata.
 * Order: prebuilt (tokens-prebuilt/, the flagship marks) -> disk cache (TOKEN_CACHE_DIR, default <repo>/data/tokens,
 * which survives redeploys) -> compose now from the asset logo and cache it -> generated tile, kept in memory for an
 * hour only so a logo that appears later still gets picked up.
 */
const PREBUILT = path.join(process.cwd(), "tokens-prebuilt");
const cacheDir = () => path.join(process.env.TOKEN_CACHE_DIR?.trim() || path.join(findRepoRoot(), "data", "tokens"), `v${MARK_VERSION}`);
const TYPES: Record<string, string> = { png: "image/png", svg: "image/svg+xml" };

type Built = { png: Buffer; svg: string; cached: boolean };
const inflight = new Map<string, Promise<Built>>();
const fallbacks = new Map<string, { at: number; png: Buffer; svg: string }>();

function read(dir: string, name: string): Buffer | null {
  const p = path.join(dir, name);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

async function build(symbol: string, asset: { symbol: string; mint: string; logo?: string }): Promise<Built> {
  try {
    const { png, svg } = await composeMark(await fetchIcon(asset));
    const dir = cacheDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${symbol}.png`), png);
    fs.writeFileSync(path.join(dir, `${symbol}.svg`), svg);
    return { png, svg, cached: true };
  } catch {
    const f = fallbacks.get(symbol);
    if (f && Date.now() - f.at < 3_600_000) return { png: f.png, svg: f.svg, cached: false };
    const { png, svg } = await fallbackMark(symbol);
    fallbacks.set(symbol, { at: Date.now(), png, svg });
    return { png, svg, cached: false };
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const m = /^([A-Za-z0-9+_-]{2,16})\.(png|svg)$/.exec(file);
  if (!m) return new Response("Not found", { status: 404 });
  const ext = m[2];
  const lst = findLst(loadRegistry(), m[1]);
  if (!lst) return new Response("Not found", { status: 404 });
  const name = `${lst.symbol}.${ext}`;
  const headers = (long: boolean) => ({
    "content-type": TYPES[ext],
    "cache-control": long ? "public, max-age=86400, stale-while-revalidate=604800" : "public, max-age=300",
  });

  const hit = read(PREBUILT, name) ?? read(cacheDir(), name);
  if (hit) return new Response(new Uint8Array(hit), { headers: headers(true) });

  let p = inflight.get(lst.symbol);
  if (!p) {
    p = build(lst.symbol, lst.asset);
    inflight.set(lst.symbol, p);
    p.finally(() => inflight.delete(lst.symbol)).catch(() => {});
  }
  const out = await p;
  const body = ext === "png" ? new Uint8Array(out.png) : out.svg;
  return new Response(body, { headers: headers(out.cached) });
}
