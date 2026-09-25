"use client";

export type TxState = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "done"; label: string; sigs: string[] } | { kind: "error"; message: string };

export function TxStatus({ state }: { state: TxState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "busy") return <p className="mt-3 text-sm text-ink-2">{state.label}</p>;
  if (state.kind === "error")
    return (
      <p className="mt-3 text-sm text-debit" role="alert">
        {state.message}
      </p>
    );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <span className="stamp">{state.label}</span>
      {state.sigs.map((s) => (
        <a key={s} className="font-mono text-ink-2 underline decoration-rule underline-offset-2" href={`https://solscan.io/tx/${s}`} target="_blank" rel="noreferrer">
          {s.slice(0, 8)}…
        </a>
      ))}
    </div>
  );
}

export function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/User rejected/i.test(m)) return "You cancelled the signature. Nothing was sent.";
  if (/insufficient/i.test(m)) return "Not enough SOL to cover that amount plus fees.";
  return m.length > 220 ? m.slice(0, 220) + "…" : m;
}
