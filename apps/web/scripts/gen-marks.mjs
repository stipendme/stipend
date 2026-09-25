// Generates public/tokens/<symbol>.svg for every LST in the registry (used by token metadata).
import fs from "node:fs";
import path from "node:path";

const regPath = process.env.REGISTRY_PATH ?? path.resolve(process.cwd(), "../../config/registry.json");
const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
const palette = ["#1E7A56", "#2B4C7E", "#8A4B1F", "#5A3E85", "#9C2F5A", "#1F6F7A", "#6B6B1E", "#3D5A26"];
const color = (s) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
};
fs.mkdirSync("public/tokens", { recursive: true });
for (const lst of reg.lsts) {
  const letters = lst.symbol.replace(/sol$/i, "").slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${color(lst.symbol)}"/><rect x="4" y="21" width="24" height="2" fill="rgba(255,255,255,0.35)"/><text x="16" y="17" text-anchor="middle" font-family="IBM Plex Sans, system-ui, sans-serif" font-weight="600" font-size="12" fill="#fff">${letters}</text><text x="16" y="28" text-anchor="middle" font-family="IBM Plex Sans, system-ui, sans-serif" font-size="3.6" fill="rgba(255,255,255,0.85)">${lst.symbol}</text></svg>\n`;
  fs.writeFileSync(path.join("public/tokens", `${lst.symbol}.svg`), svg);
  console.log("wrote", lst.symbol);
}
