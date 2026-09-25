import type { LstsResponse, ClaimsResponse } from "./types";

export async function fetchLsts(): Promise<LstsResponse> {
  const r = await fetch("/api/lsts");
  if (!r.ok) throw new Error("Could not load pools");
  return r.json();
}

export async function fetchClaims(wallet: string): Promise<ClaimsResponse> {
  const r = await fetch(`/api/claims/${wallet}`);
  if (!r.ok) throw new Error("Could not load claims");
  return r.json();
}
