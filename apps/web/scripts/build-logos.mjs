// Builds the prebuilt LST marks (the flagship pools) into tokens-prebuilt/.
//   node scripts/build-logos.mjs            # every LST in the registry
//   node scripts/build-logos.mjs nvdaSOL    # one
// Pools launched later get theirs on demand from app/tokens/[file]/route.ts, which uses the same compose code.
import fs from "node:fs";
import path from "node:path";
import { fetchIcon, composeMark } from "../lib/logo-compose.mjs";

const regPath = process.env.REGISTRY_PATH ?? path.resolve(process.cwd(), "../../config/registry.json");
const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
const only = process.argv.slice(2);
const outDir = "tokens-prebuilt";
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync("public/tokens/assets", { recursive: true });

for (const lst of reg.lsts) {
  if (only.length && !only.map((s) => s.toLowerCase()).includes(lst.symbol.toLowerCase())) continue;
  try {
    const { png, svg, assetPng } = await composeMark(await fetchIcon(lst.asset));
    fs.writeFileSync(path.join("public/tokens/assets", `${lst.asset.symbol}.png`), assetPng);
    fs.writeFileSync(path.join(outDir, `${lst.symbol}.png`), png);
    fs.writeFileSync(path.join(outDir, `${lst.symbol}.svg`), svg);
    console.log("wrote", lst.symbol, `(${lst.asset.symbol})`);
  } catch (e) {
    console.error("skip", lst.symbol, e.message);
  }
}
