import { PublicKey } from "@solana/web3.js";
import { fetchMintInfo, tokenProgramName, type LstEntry } from "@stipend/core";
import { makeCtx, saveReg, table } from "../lib/ctx.js";

/** Default asset menu. lst = LST symbol; query = Jupiter search; exact mint pinned where known so a lookalike can never be picked. */
const MENU: { lst: string; name: string; query: string; mint?: string; category: string; blurb: string }[] = [
  { lst: "nvdaSOL", name: "Stipend NVIDIA SOL", query: "NVDAx", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", category: "stock", blurb: "Hold nvdaSOL, get paid NVIDIA every epoch." },
  { lst: "aaplSOL", name: "Stipend Apple SOL", query: "AAPLx", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", category: "stock", blurb: "Hold aaplSOL, get paid Apple every epoch." },
  { lst: "tslaSOL", name: "Stipend Tesla SOL", query: "TSLAx", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", category: "stock", blurb: "Hold tslaSOL, get paid Tesla every epoch." },
  { lst: "googlSOL", name: "Stipend Alphabet SOL", query: "GOOGLx", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", category: "stock", blurb: "Hold googlSOL, get paid Alphabet every epoch." },
  { lst: "mstrSOL", name: "Stipend Strategy SOL", query: "MSTRx", mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", category: "stock", blurb: "Hold mstrSOL, get paid MicroStrategy every epoch." },
  { lst: "spySOL", name: "Stipend S&P 500 SOL", query: "SPYx", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", category: "etf", blurb: "Hold spySOL, get paid the S&P 500 every epoch." },
  { lst: "goldSOL", name: "Stipend Gold SOL", query: "GLDx", mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re", category: "metal", blurb: "Hold goldSOL, get paid gold every epoch." },
  { lst: "btcSOL", name: "Stipend Bitcoin SOL", query: "cbBTC", mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", category: "crypto", blurb: "Hold btcSOL, get paid Bitcoin every epoch." },
  { lst: "usdcSOL", name: "Stipend Dollar SOL", query: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", category: "stable", blurb: "Hold usdcSOL, get paid dollars every epoch." },
];

interface JupToken { id: string; symbol: string; name: string; decimals: number; tokenProgram: string; isVerified?: boolean; liquidity?: number; icon?: string }

export async function assetsSync(args: { dryRun?: boolean }) {
  const ctx = makeCtx({ dryRun: args.dryRun });
  const rows: Record<string, unknown>[] = [];
  for (const m of MENU) {
    const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(m.query)}`);
    if (!r.ok) { rows.push({ lst: m.lst, result: `jupiter search ${r.status}` }); continue; }
    const list = (await r.json()) as JupToken[];
    const tok = m.mint ? list.find((t) => t.id === m.mint) : list.find((t) => t.symbol === m.query && t.isVerified);
    if (!tok) { rows.push({ lst: m.lst, result: `mint not found on Jupiter (${m.query}${m.mint ? " " + m.mint : ""})` }); continue; }
    if (!tok.isVerified) { rows.push({ lst: m.lst, result: `not Jupiter-verified: ${tok.id}` }); continue; }
    let info;
    try { info = await fetchMintInfo(ctx.conn, new PublicKey(tok.id)); } catch (e) { rows.push({ lst: m.lst, result: `rpc: ${(e as Error).message}` }); continue; }
    if (info.mint.decimals !== tok.decimals) { rows.push({ lst: m.lst, result: `decimals mismatch chain ${info.mint.decimals} vs jupiter ${tok.decimals}` }); continue; }
    const delivery: LstEntry["delivery"] = "direct"; // D10: airdrop for every LST; merkle stays dormant
    const existing = ctx.reg.lsts.find((l) => l.symbol === m.lst);
    const entry: LstEntry = existing ?? {
      symbol: m.lst, name: m.name, blurb: m.blurb, asset: { symbol: tok.symbol, name: tok.name, mint: tok.id, decimals: tok.decimals, tokenProgram: tokenProgramName(info.program), logo: tok.icon, category: m.category },
      stakePool: "", mint: "", validatorList: "", reserve: "", managerFeeAccount: "", createdEpoch: 0, status: "draft", delivery,
    };
    if (existing) { existing.asset = { ...existing.asset, symbol: tok.symbol, name: tok.name, mint: tok.id, decimals: tok.decimals, tokenProgram: tokenProgramName(info.program), logo: tok.icon ?? existing.asset.logo }; existing.delivery = delivery; }
    else ctx.reg.lsts.push(entry);
    rows.push({ lst: m.lst, asset: tok.symbol, mint: tok.id, dec: tok.decimals, program: tokenProgramName(info.program), hook: info.hasTransferHook, delivery, liq: Math.round(tok.liquidity ?? 0), result: existing ? "updated" : "added (draft)" });
  }
  table(rows);
  if (!ctx.dryRun) { saveReg(ctx); console.log("registry saved"); }
}
