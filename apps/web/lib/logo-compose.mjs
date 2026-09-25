// Shared LST mark composition: used by scripts/build-logos.mjs (offline, the flagship marks) and by
// app/tokens/[file]/route.ts (on demand, for pools launched after the build). Plain ESM so node can run the script directly.
import sharp from "sharp";

export const SIZE = 512;
// Wallets and explorers crop token images to a circle of radius SIZE/2. The badge must sit wholly inside that circle
// and be large enough that the LST reads as "Solana + asset", not as the asset itself.
export const BADGE = 236; // ~46% of the diameter
const INSET = 8; // gap between the badge edge and the crop circle
// badge centre along the 45° diagonal so that (distance from centre + badge radius) = SIZE/2 - INSET
const BADGE_CENTRE = SIZE / 2 + (SIZE / 2 - INSET - BADGE / 2) / Math.SQRT2;
export const BADGE_OFFSET = Math.round(BADGE_CENTRE - BADGE / 2);

/** Fetch the asset's raw logo bytes: registry logo, else Jupiter tokens v2 `icon` by mint, with IPFS gateway fallbacks. */
export async function fetchIcon(asset) {
  let url = asset.logo;
  if (!url) {
    const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${asset.mint}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = await r.json();
      const list = Array.isArray(j) ? j : j?.tokens ?? [];
      const hit = list.find((t) => t.id === asset.mint);
      if (hit) url = hit.icon;
    }
  }
  if (!url) throw new Error(`no icon for ${asset.symbol}`);
  const m = url.match(/\/ipfs\/([^/?#]+)/);
  const candidates = m
    ? [url, ...(asset.symbol === "cbBTC" ? ["https://assets.coingecko.com/coins/images/40143/large/cbbtc.webp"] : []), `https://cloudflare-ipfs.com/ipfs/${m[1]}`, `https://gateway.pinata.cloud/ipfs/${m[1]}`, `https://dweb.link/ipfs/${m[1]}`]
    : [url];
  let last = "";
  for (const u of candidates) {
    try {
      const r = await fetch(u, { headers: { "user-agent": "stipend-logos/1" }, signal: AbortSignal.timeout(10000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      last = `${r.status} ${u}`;
    } catch (e) {
      last = `${e.message} ${u}`;
    }
  }
  throw new Error(`${asset.symbol}: ${last}`);
}

export const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE}" height="${BADGE}" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945FF"/><stop offset="1" stop-color="#14F195"/></linearGradient></defs>
  <circle cx="50" cy="50" r="50" fill="#101815"/>
  <circle cx="50" cy="50" r="47.5" fill="#FFFFFF"/>
  <circle cx="50" cy="50" r="42" fill="#101815"/>
  <g fill="url(#g)">
    <path d="M32 29 H74 L66 38 H24 Z"/>
    <path d="M24 45.5 H66 L74 54.5 H32 Z"/>
    <path d="M32 62 H74 L66 71 H24 Z"/>
  </g>
</svg>`;

const circleMask = () =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="#fff"/></svg>`);

/** Compose the LST mark from raw asset logo bytes: the logo in a circle with the Solana badge bottom-right. */
export async function composeMark(raw) {
  const assetPng = await sharp(raw).resize(SIZE, SIZE, { fit: "cover" }).png().toBuffer();
  const disc = await sharp(assetPng).composite([{ input: circleMask(), blend: "dest-in" }]).png().toBuffer();
  const badge = await sharp(Buffer.from(badgeSvg)).png().toBuffer();
  const off = BADGE_OFFSET;
  const png = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: disc, left: 0, top: 0 }, { input: badge, left: off, top: off }])
    .png()
    .toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<image href="data:image/png;base64,${disc.toString("base64")}" width="${SIZE}" height="${SIZE}"/>
<svg x="${off}" y="${off}" width="${BADGE}" height="${BADGE}" viewBox="0 0 100 100">${badgeSvg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</svg>
</svg>
`;
  return { png, svg, assetPng };
}

const palette = ["#1E7A56", "#2B4C7E", "#8A4B1F", "#5A3E85", "#9C2F5A", "#1F6F7A", "#6B6B1E", "#3D5A26"];
const colorFor = (s) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
};

/** The generated tile (same style as components/Mark.tsx) for when no asset logo can be fetched. */
export async function fallbackMark(symbol) {
  const letters = symbol.replace(/sol$/i, "").slice(0, 2).toUpperCase();
  const font = "IBM Plex Sans, DejaVu Sans, Liberation Sans, sans-serif";
  // letters sit up and left of centre so the badge (bottom-right) never covers them
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 32 32"><rect width="32" height="32" fill="${colorFor(symbol)}"/><text x="12.5" y="16.5" text-anchor="middle" font-family="${font}" font-weight="600" font-size="10" fill="#fff">${letters}</text></svg>`;
  const raw = await sharp(Buffer.from(tile)).resize(SIZE, SIZE).png().toBuffer();
  const { png, svg } = await composeMark(raw);
  return { png, svg };
}
