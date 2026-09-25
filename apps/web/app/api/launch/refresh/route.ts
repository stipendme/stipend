import { NextResponse } from "next/server";
import { currentStepTx, remainingStepsTx, LaunchError } from "@/lib/launch-server";
export const dynamic = "force-dynamic";
/** Returns the current step's transaction with a fresh blockhash and the backend signatures. Call it right before the wallet prompt, and again if it expired. */
export async function POST(req: Request) {
  try {
    const { id, all } = (await req.json()) as { id?: string; all?: boolean };
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    return NextResponse.json(all ? await remainingStepsTx(id) : await currentStepTx(id));
  } catch (e) {
    if (e instanceof LaunchError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
