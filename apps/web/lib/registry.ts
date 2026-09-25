import path from "node:path";
import { loadRegistry as coreLoadRegistry, findLst as coreFindLst } from "@stipend/core";
import type { Registry, LstEntry } from "./types";

/** REGISTRY_PATH (web) overrides STIPEND_REGISTRY (core) which defaults to <repo>/config/registry.json. */
export function loadRegistry(): Registry {
  const env = process.env.REGISTRY_PATH?.trim();
  return coreLoadRegistry(env ? path.resolve(process.cwd(), env) : undefined);
}

export function findLst(registry: Registry, symbol: string): LstEntry | undefined {
  // core's findLst throws on an unknown symbol; callers here want undefined (-> 404)
  try {
    const hit = coreFindLst(registry, symbol);
    if (hit) return hit;
  } catch {
    /* fall through */
  }
  return registry.lsts.find((l) => l.symbol.toLowerCase() === symbol.toLowerCase());
}
