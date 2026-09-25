import { NextResponse } from "next/server";
import { launchStatus, LaunchError } from "@/lib/launch-server";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { return NextResponse.json(launchStatus(id)); } catch (e) {
    if (e instanceof LaunchError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
