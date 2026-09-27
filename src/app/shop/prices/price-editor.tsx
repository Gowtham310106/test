"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, Card, Input, Spinner } from "@/components/ui";
import { formatRupees } from "@/lib/format";
import type { ColorMode, PriceTier } from "@/lib/types";
import { savePriceTiers } from "../actions";

interface Row {
  key: string;
  minPages: string;
  cash: string;
  online: string;
}

function toRow(t: PriceTier): Row {
  return {
    key: crypto.randomUUID(),
    minPages: String(t.min_pages),
    cash: (t.rate_cash_paise / 100).toString(),
    online: (t.rate_online_paise / 100).toString(),
  };
}

function rupeesToPaise(v: string) {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

// Razorpay's standard fee is about 2% + GST; this suggests an online rate
// that leaves the shop with its full cash rate.
const GATEWAY_FEE = 0.0236;

export function PriceEditor({ mode, tiers }: { mode: ColorMode; tiers: PriceTier[] }) {
  const [rows, setRows] = useState<Row[]>(() => (tiers.length ? tiers.map(toRow) : [{ key: "new", minPages: "1", cash: "", online: "" }]));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (key: string, patch: Partial<Row>) => {
    setResult(null);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const parsed = rows.map((r) => ({
    min_pages: Number(r.minPages),
    rate_cash_paise: rupeesToPaise(r.cash),
    rate_online_paise: rupeesToPaise(r.online),
  }));
  const invalid =
    parsed.some(
      (p) =>
        !Number.isInteger(p.min_pages) ||
        p.min_pages < 1 ||
        !Number.isInteger(p.rate_cash_paise) ||
        p.rate_cash_paise < 1 ||
        !Number.isInteger(p.rate_online_paise) ||
        p.rate_online_paise < 1,
    ) ||
    !parsed.some((p) => p.min_pages === 1) ||
    new Set(parsed.map((p) => p.min_pages)).size !== parsed.length;

  const save = () =>
    start(async () => {
      const sorted = [...parsed].sort((a, b) => a.min_pages - b.min_pages);
      const r = await savePriceTiers(mode, sorted);
      setResult(r.ok ? { ok: true, text: "Prices saved. New orders use them right away." } : { ok: false, text: r.error ?? "Couldn't save." });
    });

  return (
    <Card className="p-4">
      <h2 className="font-semibold">{mode === "bw" ? "Black & white" : "Colour"} (A4, per page)</h2>
      <p className="mt-1 text-sm text-muted">
        The rate is picked by how many {mode === "bw" ? "B&W" : "colour"} pages the whole order has. One row must start at 1 page.
      </p>

      <div className="mt-4 space-y-2">
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-muted">
          <span>From pages</span>
          <span>Cash ₹/page</span>
          <span>Online ₹/page</span>
          <span className="w-9" />
        </div>
        {rows.map((r) => {
          const cash = rupeesToPaise(r.cash);
          const suggested = Number.isFinite(cash) ? Math.ceil(cash / (1 - GATEWAY_FEE)) : null;
          return (
            <div key={r.key}>
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                <Input inputMode="numeric" value={r.minPages} onChange={(e) => set(r.key, { minPages: e.target.value.replace(/\D/g, "") })} aria-label="From pages" />
                <Input inputMode="decimal" value={r.cash} onChange={(e) => set(r.key, { cash: e.target.value })} aria-label="Cash rate in rupees" />
                <Input inputMode="decimal" value={r.online} onChange={(e) => set(r.key, { online: e.target.value })} aria-label="Online rate in rupees" />
                <Button
                  type="button"
                  variant="ghost"
                  className="w-9 px-0"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  disabled={rows.length === 1}
                  aria-label="Remove row"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {suggested && rupeesToPaise(r.online) < suggested ? (
                <p className="mt-1 text-xs text-muted">
                  To cover the gateway fee, charge about {formatRupees(suggested)} online.{" "}
                  <button type="button" className="text-accent hover:underline" onClick={() => set(r.key, { online: (suggested / 100).toString() })}>
                    Use it
                  </button>
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows((rs) => [...rs, { key: crypto.randomUUID(), minPages: "", cash: "", online: "" }])}
          disabled={rows.length >= 10}
        >
          <Plus className="size-4" aria-hidden /> Add bulk rate
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending || invalid}>
          {pending ? <Spinner /> : null} Save
        </Button>
        {invalid ? <span className="text-xs text-muted">Fill every row; one must start at 1 page; no repeats.</span> : null}
      </div>
      {result ? (
        <Alert tone={result.ok ? "success" : "danger"} className="mt-3">
          {result.text}
        </Alert>
      ) : null}
    </Card>
  );
}
