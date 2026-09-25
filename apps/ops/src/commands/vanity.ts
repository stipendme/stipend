/**
 * Vanity key bank: grind with cavemanloverboy/vanity (tools/vanity/upstream, GPU build), ingest hits into keys/vanity.
 *
 *   ops vanity grind --mode suffix --count 50                 # ...stip reserve
 *   ops vanity grind --mode prefix [--count 1]                # <TICKER>... for every target
 *   ops vanity grind --mode both [--max-prefix 4] [--top 24]  # <TICKER>...stip, the expensive one; run under nohup
 *   ops vanity list | ops vanity take --ticker NVDA [--dry-run]
 *
 * All matching is case-insensitive (the grinder's --case-insensitive folds A-Z/a-z except L). Batches of 64 patterns
 * (VANITY_MAX_PATTERNS). Resumable: targets that already have a free key of the requested kind are skipped, every hit
 * is ingested as soon as the batch ends, and a killed run loses at most the current batch's in-flight hits (which are
 * still on disk in the work dir and ingested by the next run).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { findRepoRoot, addVanityKey, listVanityBank, readVanityIndex, takeVanityKey, vanityDir, type VanityKind } from "@stipend/core";
import { table } from "../lib/ctx.js";

interface Target { ticker: string; prefix: string; suffix: string; priority: number; source: string; solanaNative: boolean }

function loadTargets(path?: string): { suffix: string; targets: Target[] } {
  const p = path ?? join(findRepoRoot(), "tools", "vanity", "targets.json");
  return JSON.parse(readFileSync(p, "utf8")) as { suffix: string; targets: Target[] };
}

function binary(): string {
  const p = process.env.VANITY_BIN ?? join(findRepoRoot(), "tools", "vanity", "upstream", "target", "release", "vanity");
  if (!existsSync(p)) throw new Error(`vanity binary not found at ${p}; build tools/vanity/upstream with PATH=/usr/local/cuda-11.7/bin:$PATH VANITY_CUDA_ARCH=86 cargo build --release --features=gpu`);
  return p;
}

const fold = (s: string) => s.toLowerCase();
const BS58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Rewrite a ticker into a base58-representable pattern for case-insensitive matching: O->o, I->i, l->L. Digit 0 has no base58 form -> null. */
function bs58Pattern(t: string): string | null {
  let out = "";
  for (const ch of t) {
    if (BS58.includes(ch)) out += ch;
    else if (BS58.includes(ch.toLowerCase())) out += ch.toLowerCase();
    else if (BS58.includes(ch.toUpperCase())) out += ch.toUpperCase();
    else return null;
  }
  return out;
}

/** Ingest every <pubkey>.json in the work dir, classifying against the pattern list. */
function ingest(workDir: string, patterns: { pattern: string; prefix: string; suffix: string; ticker: string; kind: VanityKind }[]): number {
  let n = 0;
  for (const f of readdirSync(workDir)) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}\.json$/.test(f)) continue;
    const pub = f.slice(0, -5);
    const secret = JSON.parse(readFileSync(join(workDir, f), "utf8")) as number[];
    const pl = fold(pub);
    const hit = patterns.find((p) => pl.startsWith(fold(p.prefix)) && pl.endsWith(fold(p.suffix)));
    if (!hit) { renameSync(join(workDir, f), join(workDir, `unmatched-${f}`)); continue; }
    const added = addVanityKey(secret, { pattern: hit.pattern, prefix: hit.prefix, suffix: hit.suffix, ticker: hit.ticker, kind: hit.kind });
    unlinkSync(join(workDir, f));
    if (added) n++;
  }
  return n;
}

export async function vanityGrind(args: { mode?: string; count?: string; targets?: string; top?: string; maxPrefix?: string; tickers?: string; dryRun?: boolean }) {
  const mode = (args.mode ?? "suffix") as VanityKind;
  if (!["suffix", "prefix", "both"].includes(mode)) throw new Error("--mode suffix|prefix|both");
  const count = Number(args.count ?? 1);
  const { suffix, targets } = loadTargets(args.targets);
  const maxPrefix = Number(args.maxPrefix ?? (mode === "both" ? 4 : 5)); // 6-char prefixes take ~30 min each on this GPU; those tickers use the ...stip reserve
  const top = args.top ? Number(args.top) : undefined;
  const bank = readVanityIndex();
  const free = (kind: VanityKind, ticker: string) => bank.entries.filter((e) => !e.used && e.kind === kind && e.ticker.toLowerCase() === ticker.toLowerCase()).length;

  let patterns: { pattern: string; prefix: string; suffix: string; ticker: string; kind: VanityKind; need: number }[] = [];
  if (mode === "suffix") {
    const have = bank.entries.filter((e) => !e.used && e.kind === "suffix").length;
    const need = Math.max(0, count - have);
    if (need > 0) patterns.push({ pattern: `...${suffix}`, prefix: "", suffix, ticker: "", kind: "suffix", need });
  } else {
    let list = targets.filter((t) => t.prefix.length <= maxPrefix);
    if (args.tickers) {
      // explicit flagship order; unknown tickers become ad-hoc targets
      const want = args.tickers.split(",").map((x) => x.trim()).filter(Boolean);
      list = want.map((w) => targets.find((t) => t.ticker.toLowerCase() === w.toLowerCase()) ?? { ticker: w, prefix: w, suffix, priority: 0, source: "manual", solanaNative: false });
      list = list.filter((t) => t.prefix.length <= maxPrefix);
    }
    if (top) list = list.slice(0, top);
    const skipped: string[] = [];
    for (const t0 of list) {
      const pre = bs58Pattern(t0.prefix);
      if (!pre) { skipped.push(t0.ticker); continue; }
      const t = { ...t0, prefix: pre };
      const need = Math.max(0, count - free(mode, t.ticker));
      if (need === 0) continue;
      patterns.push(mode === "prefix"
        ? { pattern: `${t.prefix}...`, prefix: t.prefix, suffix: "", ticker: t.ticker, kind: "prefix", need }
        : { pattern: `${t.prefix}...${suffix}`, prefix: t.prefix, suffix, ticker: t.ticker, kind: "both", need });
    }
    if (skipped.length) console.log(`skipped (not representable in base58, contain a digit 0): ${skipped.join(" ")}`);
  }
  // group by difficulty so a batch never waits on one long prefix
  patterns.sort((a, b) => (a.prefix.length + a.suffix.length) - (b.prefix.length + b.suffix.length));
  if (patterns.length === 0) { console.log(`nothing to grind for mode ${mode}: bank already satisfied`); return; }
  console.log(`mode ${mode}: ${patterns.length} patterns, ${count} each`);
  if (args.dryRun) { console.log(patterns.map((p) => p.pattern).join(" ")); return; }

  const workDir = join(findRepoRoot(), "tools", "vanity", "work", mode);
  mkdirSync(workDir, { recursive: true });
  const bin = binary();
  // ingest leftovers from a previous killed run first
  const leftovers = ingest(workDir, patterns);
  if (leftovers) console.log(`ingested ${leftovers} leftover keys from ${workDir}`);

  const BATCH = 64;
  for (let i = 0; i < patterns.length; i += BATCH) {
    const batch = patterns.slice(i, i + BATCH);
    const maxNeed = Math.max(...batch.map((p) => p.need));
    const cli = ["grind-keypair", "--case-insensitive", "--count", String(maxNeed), "--num-gpus", process.env.VANITY_GPUS ?? "1", "--num-cpus", process.env.VANITY_CPUS ?? "1"];
    for (const p of batch) cli.push("--pattern", p.pattern);
    console.log(`batch ${i / BATCH + 1}/${Math.ceil(patterns.length / BATCH)}: ${batch.length} patterns (${batch.map((p) => p.pattern).slice(0, 6).join(" ")}${batch.length > 6 ? " ..." : ""})`);
    const t0 = Date.now();
    // Long batches (the ...stip "both" mode runs for days): ingest hits every minute so the bank sees them immediately
    // and a kill loses nothing but the current minute.
    const status = await new Promise<number | null>((resolve) => {
      const child = spawn(bin, cli, { cwd: workDir, stdio: ["ignore", "inherit", "inherit"] });
      const timer = setInterval(() => { const k = ingest(workDir, patterns); if (k) console.log(`ingested ${k} keys (running)`); }, 60_000);
      child.on("close", (code) => { clearInterval(timer); resolve(code); });
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    const n = ingest(workDir, patterns);
    console.log(`batch done in ${secs}s (exit ${status}); ingested ${n} keys`);
  }
  const { summary } = listVanityBank();
  console.log("bank:", JSON.stringify(summary));
}

export async function vanityList() {
  const { entries, summary } = listVanityBank();
  console.log(`dir ${vanityDir()}`);
  console.log("summary:", JSON.stringify(summary));
  table(entries.map((e) => ({ kind: e.kind, ticker: e.ticker, pattern: e.pattern, pubkey: e.pubkey, used: e.used ? (e.usedFor ?? "yes") : "" })));
}

export async function vanityTake(args: { ticker?: string; dryRun?: boolean }) {
  const r = takeVanityKey({ ticker: args.ticker, dryRun: args.dryRun, usedFor: args.dryRun ? undefined : `manual take ${new Date().toISOString()}` });
  if (!r) { console.log(`no free vanity key for ${args.ticker ?? "(suffix reserve)"}`); process.exitCode = 1; return; }
  console.log(`${args.dryRun ? "[dry-run] would take" : "took"} ${r.entry.kind} key ${r.keypair.publicKey.toBase58()} (${r.pattern})`);
}
