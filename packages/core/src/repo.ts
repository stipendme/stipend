import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Registry } from "./registry.js";

/** Walks up from this file (or cwd) until it finds pnpm-workspace.yaml. */
export function findRepoRoot(from?: string): string {
  const starts = [from, process.env.STIPEND_ROOT, process.cwd(), dirname(fileURLToPath(import.meta.url))].filter(
    (s): s is string => !!s,
  );
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("Stipend repo root not found (no pnpm-workspace.yaml above cwd); set STIPEND_ROOT");
}

export function registryPath(path?: string): string {
  return path ?? process.env.STIPEND_REGISTRY ?? join(findRepoRoot(), "config", "registry.json");
}

export function loadRegistry(path?: string): Registry {
  const p = registryPath(path);
  const reg = JSON.parse(readFileSync(p, "utf8")) as Registry;
  if (!Array.isArray(reg.lsts)) throw new Error(`registry at ${p} has no lsts array`);
  return reg;
}

export function saveRegistry(reg: Registry, path?: string): void {
  const p = registryPath(path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(reg, null, 2) + "\n");
}

export function findLst(reg: Registry, symbol: string) {
  const lst = reg.lsts.find((l) => l.symbol.toLowerCase() === symbol.toLowerCase());
  if (!lst) throw new Error(`LST ${symbol} not in registry (have: ${reg.lsts.map((l) => l.symbol).join(", ") || "none"})`);
  return lst;
}

export function liveLsts(reg: Registry) {
  return reg.lsts.filter((l) => l.status === "live");
}
