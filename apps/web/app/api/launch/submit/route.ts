import { NextResponse } from "next/server";
import { submitStep, LaunchError } from "@/lib/launch-server";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const { id, tx } = (await req.json()) as { id?: string; tx?: string };
    if (!id || !tx) return NextResponse.json({ error: "id and tx required" }, { status: 400 });
    return NextResponse.json(await submitStep(id, tx));
  } catch (e) {
    if (e instanceof LaunchError) return NextResponse.json({ error: e.message, expired: e.status === 409 }, { status: e.status });
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
