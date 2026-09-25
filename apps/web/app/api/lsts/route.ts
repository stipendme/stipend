import { NextResponse } from "next/server";
import { buildLstsResponse } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await buildLstsResponse();
  return NextResponse.json(data, { headers: { "cache-control": "public, max-age=60" } });
}
