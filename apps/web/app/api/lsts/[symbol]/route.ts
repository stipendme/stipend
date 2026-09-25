import { NextResponse } from "next/server";
import { buildLstsResponse } from "@/lib/views";
import { openDb, getDistributionHistory } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const data = await buildLstsResponse();
  const view = data.lsts.find((l) => l.entry.symbol.toLowerCase() === symbol.toLowerCase());
  if (!view) return NextResponse.json({ error: "Unknown LST" }, { status: 404 });
  const db = openDb();
  const history = db ? getDistributionHistory(db, view.entry.symbol, 30) : [];
  db?.close();
  return NextResponse.json({ ...view, validator: data.validator, fees: data.fees, history }, { headers: { "cache-control": "public, max-age=60" } });
}
