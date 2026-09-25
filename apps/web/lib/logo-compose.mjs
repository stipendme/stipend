// Shared LST mark composition: used by scripts/build-logos.mjs (offline, the flagship marks) and by
// app/tokens/[file]/route.ts (on demand, for pools launched after the build). Plain ESM so node can run the script directly.
import sharp from "sharp";

export const SIZE = 512;
export const BADGE = 176;

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
  <circle cx="50" cy="50" r="50" fill="#F5F7F4"/>
  <circle cx="50" cy="50" r="43" fill="url(#g)"/>
  <g fill="#fff" transform="translate(50 50) skewX(-22) translate(-50 -50)">
    <rect x="30" y="31" width="40" height="9" rx="1.5"/>
    <rect x="30" y="45.5" width="40" height="9" rx="1.5"/>
    <rect x="30" y="60" width="40" height="9" rx="1.5"/>
  </g>
</svg>`;

const circleMask = () =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="#fff"/></svg>`);

/** Compose the LST mark from raw asset logo bytes: the logo in a circle with the Solana badge bottom-right. */
export async function composeMark(raw) {
  const assetPng = await sharp(raw).resize(SIZE, SIZE, { fit: "cover" }).png().toBuffer();
  const disc = await sharp(assetPng).composite([{ input: circleMask(), blend: "dest-in" }]).png().toBuffer();
  const badge = await sharp(Buffer.from(badgeSvg)).png().toBuffer();
  const off = SIZE - BADGE + 8;
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${colorFor(symbol)}"/><rect x="4" y="21" width="24" height="2" fill="rgba(255,255,255,0.35)"/><text x="16" y="17" text-anchor="middle" font-family="${font}" font-weight="600" font-size="12" fill="#fff">${letters}</text><text x="16" y="28" text-anchor="middle" font-family="${font}" font-size="3.6" fill="rgba(255,255,255,0.85)">${symbol}</text></svg>\n`;
  const png = await sharp(Buffer.from(svg)).resize(SIZE, SIZE).png().toBuffer();
  return { png, svg };
}
