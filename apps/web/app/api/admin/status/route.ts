import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { buildLstsResponse } from "@/lib/views";
import { openDb, getRecentEpochRuns } from "@/lib/db";
import { loadRegistry } from "@/lib/registry";
import { dbPath } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = verifyAdmin(req.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  const registry = loadRegistry();
  const data = await buildLstsResponse();
  const db = openDb();
  const runs = db ? getRecentEpochRuns(db, 20) : [];
  db?.close();
  return NextResponse.json({
    ...data,
    keysHint: { treasury: registry.treasury, network: registry.network },
    dbPath: dbPath(),
    dbPresent: !!db,
    runs,
  });
}
