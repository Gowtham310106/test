import type { Metadata } from "next";
import Link from "next/link";
import { ColumnChart } from "@/components/column-chart";
import { Card, cx } from "@/components/ui";
import { requireProfile } from "@/lib/data";
import { formatRupees } from "@/lib/format";

export const metadata: Metadata = { title: "Pilot stats" };

interface Stats {
  days: number;
  timezone: string;
  totals: {
    orders: number;
    collected: number;
    cancelled: number;
    not_collected: number;
    pages: number;
    revenue_paise: number;
    online_orders: number;
    cash_orders: number;
    avg_minutes_to_ready: number | null;
    avg_rating: number | null;
    ratings: number;
  };
  by_day: { day: string; orders: number; pages: number }[];
  by_hour: { hour: number; orders: number }[];
}

const RANGES = [7, 14, 30, 60];

function hourLabel(h: number) {
  const suffix = h < 12 ? "am" : "pm";
  const n = h % 12 === 0 ? 12 : h % 12;
  return `${n} ${suffix}`;
}

function dayLabel(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default async function StatsPage(props: PageProps<"/shop/stats">) {
  const { supabase } = await requireProfile({ staff: true });
  const params = await props.searchParams;
  const requested = Number(params.days);
  const days = RANGES.includes(requested) ? requested : 14;

  const { data, error } = await supabase.rpc("shop_stats", { p_days: days });
  if (error || !data) return <p className="text-muted">Couldn&apos;t load stats.</p>;
  const stats = data as Stats;
  const t = stats.totals;

  const everyNth = Math.ceil(stats.by_day.length / 8);
  const dayColumns = stats.by_day.map((d, i) => ({
    key: d.day,
    tick: i % everyNth === 0 || i === stats.by_day.length - 1 ? dayLabel(d.day) : "",
    label: dayLabel(d.day),
    value: d.orders,
  }));
  // Shop hours are what matter; trim empty early-morning and late-night hours.
  const busyHours = stats.by_hour.filter((h) => h.orders > 0).map((h) => h.hour);
  const first = Math.min(7, ...busyHours);
  const last = Math.max(19, ...busyHours);
  const hourColumns = stats.by_hour
    .filter((h) => h.hour >= first && h.hour <= last)
    .map((h) => ({
      key: String(h.hour),
      tick: h.hour % 2 === 0 ? hourLabel(h.hour) : "",
      label: `${hourLabel(h.hour)}–${hourLabel((h.hour + 1) % 24)}`,
      value: h.orders,
    }));

  const tiles = [
    { label: "Orders", value: t.orders.toLocaleString("en-IN"), sub: `${(t.orders / stats.days).toFixed(1)} a day` },
    { label: "Pages printed", value: t.pages.toLocaleString("en-IN"), sub: `${t.online_orders} online · ${t.cash_orders} cash orders` },
    { label: "Revenue received", value: formatRupees(t.revenue_paise), sub: "paid orders" },
    {
      label: "Avg. time to ready",
      value: t.avg_minutes_to_ready != null ? `${t.avg_minutes_to_ready} min` : "—",
      sub: "from joining the queue",
    },
    {
      label: "Not collected",
      value: String(t.not_collected),
      sub: `${t.collected} collected · ${t.cancelled} cancelled`,
    },
    {
      label: "Student rating",
      value: t.avg_rating != null ? `${t.avg_rating} / 5` : "—",
      sub: `${t.ratings} rating${t.ratings === 1 ? "" : "s"}`,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Pilot stats</h1>
          <p className="text-sm text-muted">Measure the change: orders per day, when they arrive, and how long students wait.</p>
        </div>
        <nav className="flex gap-1 rounded-lg bg-surface-muted p-1" aria-label="Date range">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/shop/stats?days=${r}`}
              className={cx("rounded-md px-3 py-1.5 text-sm font-medium", r === days ? "bg-surface shadow-sm" : "text-muted hover:text-foreground")}
              aria-current={r === days ? "page" : undefined}
            >
              {r} days
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <Card key={tile.label} className="p-4">
            <p className="text-sm text-muted">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold">{tile.value}</p>
            <p className="mt-0.5 text-xs text-muted">{tile.sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-semibold">Orders per day</h2>
          <p className="mb-4 text-sm text-muted">Last {stats.days} days</p>
          <ColumnChart columns={dayColumns} unit="orders" />
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold">When orders arrive</h2>
          <p className="mb-4 text-sm text-muted">Orders by hour of day — a flatter shape means less rush at the breaks</p>
          <ColumnChart columns={hourColumns} unit="orders" />
        </Card>
      </div>

      <details className="rounded-xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">Show as tables</summary>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <table className="w-full text-sm">
            <caption className="mb-2 text-left font-medium">Per day</caption>
            <thead className="text-muted">
              <tr>
                <th className="py-1 text-left font-normal">Day</th>
                <th className="py-1 text-right font-normal">Orders</th>
                <th className="py-1 text-right font-normal">Pages</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {stats.by_day.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="py-1">{dayLabel(d.day)}</td>
                  <td className="py-1 text-right">{d.orders}</td>
                  <td className="py-1 text-right">{d.pages}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-sm">
            <caption className="mb-2 text-left font-medium">Per hour</caption>
            <thead className="text-muted">
              <tr>
                <th className="py-1 text-left font-normal">Hour</th>
                <th className="py-1 text-right font-normal">Orders</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {stats.by_hour.map((h) => (
                <tr key={h.hour} className="border-t border-border">
                  <td className="py-1">
                    {hourLabel(h.hour)}–{hourLabel((h.hour + 1) % 24)}
                  </td>
                  <td className="py-1 text-right">{h.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
