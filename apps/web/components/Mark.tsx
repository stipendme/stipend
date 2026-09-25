/** Deterministic mark per LST: a two-letter ticket in a coloured tile. Matches /public/tokens/<symbol>.svg. */
export function markColor(symbol: string): string {
  const palette = ["#1E7A56", "#2B4C7E", "#8A4B1F", "#5A3E85", "#9C2F5A", "#1F6F7A", "#6B6B1E", "#3D5A26"];
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export function Mark({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const letters = symbol.replace(/sol$/i, "").slice(0, 2).toUpperCase();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="6" fill={markColor(symbol)} />
      <rect x="4" y="21" width="24" height="2" fill="rgba(255,255,255,0.35)" />
      <text x="16" y="17" textAnchor="middle" fontFamily="IBM Plex Sans, system-ui, sans-serif" fontWeight="600" fontSize="12" fill="#fff">
        {letters}
      </text>
    </svg>
  );
}
