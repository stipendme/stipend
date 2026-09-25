"use client";

import { useState } from "react";
import { Mark } from "./Mark";

/** The composed LST mark from /tokens/<symbol>.png (served by app/tokens/[file]/route.ts), falling back to the generated tile if it is missing. */
export function LstLogo({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Mark symbol={symbol} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/tokens/${symbol}.png`} width={size} height={size} alt="" className="shrink-0 rounded-full" onError={() => setFailed(true)} />
  );
}
