"use client";

import { useState } from "react";

export interface Column {
  key: string;
  /** Short axis label; empty to skip this tick. */
  tick: string;
  /** Full label for the tooltip and screen readers. */
  label: string;
  value: number;
}

/** 0 → max rounded up to a 1/2/5 step, with about four gridlines. */
function niceScale(max: number) {
  if (max <= 0) return { top: 4, step: 1 };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const whole = Math.max(1, Math.round(step));
  return { top: Math.ceil(max / whole) * whole, step: whole };
}

/**
 * Single-series column chart: one colour, thin columns with a rounded data
 * end, hairline grid, value on hover/focus. The page also renders the numbers
 * as a table, so nothing depends on hovering.
 */
export function ColumnChart({ columns, unit, height = 180 }: { columns: Column[]; unit: string; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...columns.map((c) => c.value));
  const { top, step } = niceScale(max);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const peak = columns.findIndex((c) => c.value === max && max > 0);

  return (
    <div className="flex gap-2 text-xs text-muted">
      <div className="relative w-8 shrink-0" style={{ height }} aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 tabular" style={{ bottom: `${(t / top) * 100}%`, transform: "translateY(50%)" }}>
            {t.toLocaleString("en-IN")}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height }} onPointerLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end" role="list">
            {columns.map((c, i) => {
              const pct = top ? (c.value / top) * 100 : 0;
              return (
                <div
                  key={c.key}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${c.label}: ${c.value} ${unit}`}
                  className="group relative flex h-full flex-1 items-end justify-center px-px outline-none"
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  {c.value > 0 ? (
                    <div
                      className={`w-full max-w-6 rounded-t-[4px] bg-accent transition-opacity ${active !== null && active !== i ? "opacity-60" : ""}`}
                      style={{ height: `${pct}%`, minHeight: 2 }}
                    />
                  ) : null}
                  {i === peak && active === null ? (
                    <span className="absolute left-1/2 -translate-x-1/2 font-medium text-foreground tabular" style={{ bottom: `calc(${pct}% + 4px)` }}>
                      {c.value}
                    </span>
                  ) : null}
                  {active === i ? (
                    <div
                      className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 whitespace-nowrap shadow-md"
                      style={{ bottom: `calc(${pct}% + 8px)`, left: "50%" }}
                    >
                      <div className="text-sm font-semibold text-foreground tabular">
                        {c.value.toLocaleString("en-IN")} {unit}
                      </div>
                      <div>{c.label}</div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-1.5 flex" aria-hidden>
          {columns.map((c) => (
            <div key={c.key} className="flex-1 overflow-visible text-center whitespace-nowrap">
              {c.tick}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
