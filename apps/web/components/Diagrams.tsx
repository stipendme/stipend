/**
 * Inline SVG diagrams for /docs. Everything is drawn with theme tokens (currentColor, --color-*) so both palettes work.
 * Each diagram has a wide layout and a stacked layout; CSS picks one by viewport.
 */

const box = { fill: "var(--color-paper-2)", stroke: "var(--color-rule)", strokeWidth: 1, rx: 6 } as const;
const label = { fill: "var(--color-ink)", fontSize: 13, fontFamily: "inherit" } as const;
const sub = { fill: "var(--color-ink-2)", fontSize: 11, fontFamily: "inherit" } as const;
const arrow = { stroke: "var(--color-ink-2)", strokeWidth: 1.25, fill: "none", markerEnd: "url(#arr)" } as const;

function Defs() {
  return (
    <defs>
      <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0,1 L9,5 L0,9" fill="none" stroke="var(--color-ink-2)" strokeWidth="1.25" />
      </marker>
    </defs>
  );
}

function Node({ x, y, w, h, title, note, accent = false }: { x: number; y: number; w: number; h: number; title: string; note?: string; accent?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} {...box} stroke={accent ? "var(--color-credit)" : box.stroke} strokeWidth={accent ? 1.5 : 1} />
      <text x={x + w / 2} y={y + (note ? h / 2 - 4 : h / 2 + 5)} textAnchor="middle" {...label} fontWeight={500}>
        {title}
      </text>
      {note && (
        <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" {...sub}>
          {note}
        </text>
      )}
    </g>
  );
}

const FLOW = [
  { title: "Your SOL", note: "in your wallet" },
  { title: "Stake pool", note: "SPL program, LST 1:1" },
  { title: "Validator", note: "earns inflation + MEV" },
  { title: "Epoch yield", note: "100% kept as fee tokens" },
  { title: "Jupiter fill", note: "SOL → the asset" },
  { title: "Holders", note: "pro rata, every epoch", accent: true },
];

/** SOL → pool → validator → yield → fee → fill → wallets. */
export function FlowDiagram() {
  const n = FLOW.length;
  // wide: six nodes in a row; the LST goes back to the wallet under the first arrow
  const W = 920, H = 150, bw = 130, bh = 54, gap = (W - n * bw) / (n - 1);
  const wide = (
    <svg viewBox={`0 0 ${W} ${H}`} className="hidden h-auto w-full sm:block" role="img" aria-label="Flow: SOL into the stake pool, delegated to the validator, yield kept as fee tokens, swapped on Jupiter, paid to holders">
      <Defs />
      {FLOW.map((f, i) => (
        <Node key={f.title} x={i * (bw + gap)} y={40} w={bw} h={bh} title={f.title} note={f.note} accent={f.accent} />
      ))}
      {FLOW.slice(1).map((_, i) => (
        <line key={i} x1={i * (bw + gap) + bw + 2} x2={(i + 1) * (bw + gap) - 3} y1={67} y2={67} {...arrow} />
      ))}
      {/* the LST comes back to the wallet */}
      <path d={`M${bw + gap / 2},96 C${bw + gap / 2},128 ${bw / 2},128 ${bw / 2},98`} {...arrow} />
      <text x={bw + gap / 2 + 6} y={126} {...sub}>
        LST back to you, 1 per SOL
      </text>
      {/* the yield leaves as the asset */}
      <text x={4 * (bw + gap) + bw / 2} y={120} textAnchor="middle" {...sub}>
        one fill per pool, published
      </text>
      <text x={5 * (bw + gap) + bw} y={120} textAnchor="end" {...sub}>
        the asset lands in your wallet
      </text>
    </svg>
  );
  const SW = 360, sbh = 52, sgap = 26, SH = n * (sbh + sgap);
  const stacked = (
    <svg viewBox={`0 0 ${SW} ${SH}`} className="h-auto w-full sm:hidden" role="img" aria-label="Flow: SOL into the stake pool, delegated to the validator, yield kept as fee tokens, swapped on Jupiter, paid to holders">
      <Defs />
      {FLOW.map((f, i) => (
        <Node key={f.title} x={40} y={i * (sbh + sgap)} w={SW - 80} h={sbh} title={f.title} note={f.note} accent={f.accent} />
      ))}
      {FLOW.slice(1).map((_, i) => (
        <line key={i} x1={SW / 2} x2={SW / 2} y1={i * (sbh + sgap) + sbh + 2} y2={(i + 1) * (sbh + sgap) - 3} {...arrow} />
      ))}
    </svg>
  );
  return (
    <>
      {wide}
      {stacked}
    </>
  );
}

const CUSTODY = [
  { title: "SPL stake pool program", sub: "holds every deposited SOL", can: ["Reserve + validator stake accounts", "Mints LST 1:1 on deposit", "Burns LST, pays SOL on redeem", "Audited; runs JitoSOL, bSOL and 240 more"], cannot: [] as string[] },
  { title: "Manager key", sub: "Stipend, on a multisig", can: ["Set fees, inside program limits", "Redeem the epoch fee tokens", "Update token name and image"], cannot: ["Withdraw anyone's SOL", "Mint LST without SOL", "Freeze or seize LST"] },
  { title: "Staker key", sub: "Stipend, hot, for rebalancing", can: ["Choose the validator", "Move stake: reserve ↔ validator"], cannot: ["Withdraw SOL from the pool", "Change fees", "Touch your wallet"] },
  { title: "Worker key", sub: "Stipend, hot, runs each epoch", can: ["Receive one epoch's redeemed fee", "Swap it and pay holders"], cannot: ["Reach principal", "Reach earlier epochs' payouts"] },
];

/** Stacked HTML version of the custody diagram for narrow screens. */
function CustodyList() {
  return (
    <div className="sm:hidden">
      {CUSTODY.map((c) => (
        <div key={c.title} className="border-b rule py-3 last:border-b-0">
          <div className="font-medium">{c.title}</div>
          <div className="text-xs text-ink-2">{c.sub}</div>
          <ul className="mt-2 space-y-1 text-sm">
            {c.can.map((x) => (
              <li key={x} className="flex gap-2">
                <span className="text-credit" aria-label="can">✓</span>
                {x}
              </li>
            ))}
            {c.cannot.map((x) => (
              <li key={x} className="flex gap-2 text-ink-2">
                <span className="text-debit" aria-label="cannot">✕</span>
                {x}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="mt-3 border rule p-2 text-center text-sm font-medium">Only the LST holder can turn LST back into SOL.</p>
    </div>
  );
}

/** What holds what, and what each key can do. */
export function CustodyDiagram() {
  const W = 920, H = 300;
  const tick = (x: number, y: number) => <path d={`M${x},${y + 6} l4,4 l8,-9`} fill="none" stroke="var(--color-credit)" strokeWidth="1.75" />;
  const cross = (x: number, y: number) => <path d={`M${x + 1},${y + 1} l10,10 M${x + 11},${y + 1} l-10,10`} fill="none" stroke="var(--color-debit)" strokeWidth="1.75" />;
  const Col = ({ x, w, title, sub: s, can, cannot }: { x: number; w: number; title: string; sub: string; can: string[]; cannot: string[] }) => (
    <g>
      <text x={x} y={16} {...label} fontWeight={600}>
        {title}
      </text>
      <text x={x} y={33} {...sub}>
        {s}
      </text>
      {can.map((c, i) => (
        <g key={c}>
          {tick(x, 50 + i * 22)}
          <text x={x + 18} y={60 + i * 22} {...label} fontSize={12.5}>
            {c}
          </text>
        </g>
      ))}
      {cannot.map((c, i) => (
        <g key={c}>
          {cross(x, 50 + (can.length + i) * 22)}
          <text x={x + 18} y={60 + (can.length + i) * 22} {...label} fontSize={12.5} fill="var(--color-ink-2)">
            {c}
          </text>
        </g>
      ))}
      <line x1={x + w - 20} x2={x + w - 20} y1={4} y2={H - 4} stroke="var(--color-rule-2)" />
    </g>
  );
  return (
    <>
    <CustodyList />
    <svg viewBox={`0 0 ${W} ${H}`} className="hidden h-auto w-full sm:block" role="img" aria-label="Custody: the SPL stake pool program holds principal; the manager and staker keys can only set fees, redeem fee tokens and choose the validator; only holders can redeem SOL">
      <Col
        x={0}
        w={240}
        title="SPL stake pool program"
        sub="holds every deposited SOL"
        can={["Reserve + validator stake accounts", "Mints LST 1:1 on deposit", "Burns LST, pays SOL on redeem", "Audited; runs JitoSOL, bSOL and 240 more"]}
        cannot={[]}
      />
      <Col
        x={240}
        w={230}
        title="Manager key"
        sub="Stipend, on a multisig"
        can={["Set fees, inside program limits", "Redeem the epoch fee tokens", "Update token name and image"]}
        cannot={["Withdraw anyone's SOL", "Mint LST without SOL", "Freeze or seize LST"]}
      />
      <Col
        x={470}
        w={230}
        title="Staker key"
        sub="Stipend, hot, for rebalancing"
        can={["Choose the validator", "Move stake: reserve ↔ validator"]}
        cannot={["Withdraw SOL from the pool", "Change fees", "Touch your wallet"]}
      />
      <Col
        x={700}
        w={220}
        title="Worker key"
        sub="Stipend, hot, runs each epoch"
        can={["Receive one epoch's redeemed fee", "Swap it and pay holders"]}
        cannot={["Reach principal", "Reach earlier epochs' payouts"]}
      />
      <rect x={0} y={H - 30} width={W} height={26} rx={6} fill="var(--color-paper-2)" stroke="var(--color-credit)" strokeWidth={1.25} />
      <text x={W / 2} y={H - 12} textAnchor="middle" {...label} fontSize={12.5} fontWeight={500}>
        Only the LST holder can turn LST back into SOL. No Stipend key can move principal, and there is no Stipend program to exploit.
      </text>
    </svg>
    </>
  );
}

/** What happens across one epoch. */
export function EpochTimeline() {
  const W = 920, H = 130;
  const x0 = 40, x1 = W - 40;
  const at = (f: number) => x0 + (x1 - x0) * f;
  const marks: { f: number; t: string; s?: string; up?: boolean }[] = [
    { f: 0, t: "Epoch starts", s: "protocol pays the previous epoch's rewards to stake accounts" },
    { f: 0.03, t: "Worker runs", s: "pool update → fee tokens → SOL → snapshot → fill → payouts", up: true },
    { f: 0.5, t: "Holding", s: "mint, redeem, trade, pair: the LST is a normal token" },
    { f: 1, t: "Epoch ends", s: "about two days; a day at 200 ms slots" },
  ];
  return (
    <>
    <ol className="sm:hidden">
      {marks.map((m) => (
        <li key={m.t} className="relative border-l-2 border-[color:var(--color-rule)] pb-4 pl-4 last:pb-0">
          <span className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full border-2 ${m.up ? "border-credit bg-credit" : "border-ink-2 bg-paper"}`} />
          <div className="font-medium">{m.t}</div>
          {m.s && <div className="text-sm text-ink-2">{m.s}</div>}
        </li>
      ))}
    </ol>
    <svg viewBox={`0 0 ${W} ${H}`} className="hidden h-auto w-full sm:block" role="img" aria-label="Epoch timeline: rewards paid at the boundary, the worker runs within the hour, holders keep the LST, next epoch">
      <Defs />
      <line x1={x0} x2={x1} y1={64} y2={64} stroke="var(--color-ink-2)" strokeWidth="1.5" markerEnd="url(#arr)" />
      {marks.map((m) => (
        <g key={m.t}>
          <circle cx={at(m.f)} cy={64} r={m.f === 0.03 ? 5 : 4} fill={m.f === 0.03 ? "var(--color-credit)" : "var(--color-paper)"} stroke={m.f === 0.03 ? "var(--color-credit)" : "var(--color-ink-2)"} strokeWidth="1.5" />
          <text x={at(m.f)} y={m.up ? 40 : 90} textAnchor={m.f <= 0.03 ? "start" : m.f === 1 ? "end" : "middle"} {...label} fontWeight={500}>
            {m.t}
          </text>
          {m.s && (
            <text x={at(m.f)} y={m.up ? 24 : 107} textAnchor={m.f <= 0.03 ? "start" : m.f === 1 ? "end" : "middle"} {...sub}>
              {m.s}
            </text>
          )}
        </g>
      ))}
    </svg>
    </>
  );
}

/** The inflation schedule: current rate stepping down by `taper` of itself each year towards `terminal`. */
export function TaperChart({ rates, terminal }: { rates: number[]; terminal: number }) {
  const W = 560, H = 170, padL = 44, padB = 26, padT = 14, padR = 16;
  const yMax = Math.max(...rates) * 1.15;
  const x = (i: number) => padL + (i / (rates.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / yMax) * (H - padT - padB);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[560px]" role="img" aria-label="Inflation rate by year on the protocol schedule">
      <line x1={padL} x2={W - padR} y1={y(terminal)} y2={y(terminal)} stroke="var(--color-rule)" strokeDasharray="3 4" />
      <text x={W - padR} y={y(terminal) - 5} textAnchor="end" {...sub}>
        terminal {(terminal * 100).toFixed(1)}%
      </text>
      {rates.map((r, i) => (
        <g key={i}>
          <rect x={x(i) - 14} y={y(r)} width={28} height={y(0) - y(r)} fill="var(--color-paper-2)" stroke="var(--color-rule)" />
          <text x={x(i)} y={y(r) - 6} textAnchor="middle" {...label} fontSize={12} className="num">
            {(r * 100).toFixed(2)}%
          </text>
          <text x={x(i)} y={H - 8} textAnchor="middle" {...sub}>
            {i === 0 ? "now" : `+${i}y`}
          </text>
        </g>
      ))}
    </svg>
  );
}
