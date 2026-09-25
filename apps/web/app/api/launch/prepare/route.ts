import { NextResponse } from "next/server";
import { prepareLaunch, LaunchError } from "@/lib/launch-server";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { assetMint?: string; symbol?: string; creator?: string };
    if (!body.assetMint || !body.symbol || !body.creator) return NextResponse.json({ error: "assetMint, symbol and creator are required" }, { status: 400 });
    return NextResponse.json(await prepareLaunch({ assetMint: body.assetMint, symbol: body.symbol, creator: body.creator }));
  } catch (e) {
    if (e instanceof LaunchError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
