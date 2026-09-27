"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Download, Search, Volume2, VolumeX } from "lucide-react";
import { PaymentBadge, StatusBadge } from "@/components/badges";
import { LiveRefresh } from "@/components/live-refresh";
import { Alert, Badge, Button, Card, Input, Select, Spinner, cx } from "@/components/ui";
import { describeJob, formatAge, formatRupees, formatTime } from "@/lib/format";
import type { CancelCode, Order, OrderItem, OrderStatus, PageDetection } from "@/lib/types";
import { setAcceptingOrders } from "./actions";

export type DashboardOrder = Order & {
  student: {
    full_name: string | null;
    roll_number: string | null;
    department: string | null;
    section: string | null;
    phone: string | null;
    no_show_count: number;
  } | null;
  items: (OrderItem & { file: { status: string; is_encrypted: boolean; page_detection: PageDetection } | null })[];
};

type Tab = "queue" | "taken" | "ready" | "done" | "attention";

const TABS: { key: Tab; label: string }[] = [
  { key: "queue", label: "Queue" },
  { key: "taken", label: "Printing" },
  { key: "ready", label: "Ready" },
  { key: "done", label: "Done today" },
];

function tabOf(o: DashboardOrder): Tab {
  if (o.payment_status === "refund_pending") return "attention";
  switch (o.status) {
    case "placed":
      return "queue";
    case "taken":
      return "taken";
    case "ready":
      return "ready";
    default:
      return "done";
  }
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // Audio may be blocked until the page is clicked once; that's fine.
  }
}

export function ShopDashboard({
  orders,
  staffNames,
  me,
  awaitingPayment,
  accepting,
  closedMessage,
  timeZone,
}: {
  orders: DashboardOrder[];
  staffNames: Record<string, string>;
  me: string;
  awaitingPayment: number;
  accepting: boolean;
  closedMessage: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("queue");
  const [query, setQuery] = useState("");
  const [sound, setSound] = useState(false);
  const [notice, setNotice] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const soundRef = useRef(sound);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read a per-device preference once after hydration
      setSound(localStorage.getItem("shop-sound") === "on");
    } catch {
      // storage unavailable
    }
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  const counts: Record<Tab, number> = { queue: 0, taken: 0, ready: 0, done: 0, attention: 0 };
  for (const o of orders) counts[tabOf(o)] += 1;

  const q = query.trim().toLowerCase();
  const visible = q
    ? orders.filter(
        (o) =>
          String(o.token).includes(q) ||
          o.student?.full_name?.toLowerCase().includes(q) ||
          o.student?.roll_number?.toLowerCase().includes(q) ||
          o.alt_contact_name?.toLowerCase().includes(q),
      )
    : orders.filter((o) => tabOf(o) === tab);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem("shop-sound", next ? "on" : "off");
    } catch {
      // ignore
    }
    if (next) beep();
  };

  return (
    <div className="space-y-4">
      <LiveRefresh
        channel="shop-orders"
        intervalMs={20_000}
        onChange={(p) => {
          const becamePlaced = p.new?.status === "placed" && p.old?.status !== "placed";
          if (becamePlaced && soundRef.current) beep();
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Orders</h1>
        <AcceptingToggle accepting={accepting} closedMessage={closedMessage} />
        <Button variant="secondary" size="sm" onClick={toggleSound} title="Beep when a new order arrives">
          {sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
          {sound ? "Sound on" : "Sound off"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex gap-1 overflow-x-auto rounded-lg bg-surface-muted p-1">
          {[...TABS, ...(counts.attention ? [{ key: "attention" as Tab, label: "Refunds" }] : [])].map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={!q && tab === t.key}
              onClick={() => {
                setTab(t.key);
                setQuery("");
              }}
              className={cx(
                "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                !q && tab === t.key ? "bg-surface shadow-sm" : "text-muted hover:text-foreground",
                t.key === "attention" && "text-danger",
              )}
            >
              {t.label} <span className="tabular">({counts[t.key]})</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Token, name or roll no."
            className="pl-9"
            inputMode="search"
            aria-label="Find an order"
          />
        </div>
      </div>

      {awaitingPayment > 0 && tab === "queue" && !q ? (
        <p className="text-xs text-muted">
          {awaitingPayment} online order{awaitingPayment === 1 ? " is" : "s are"} waiting for payment and will appear here once paid.
        </p>
      ) : null}

      {notice ? (
        <Alert tone={notice.tone} className="flex items-start justify-between gap-3">
          <span>{notice.text}</span>
          <button className="text-xs underline" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </Alert>
      ) : null}

      {visible.length === 0 ? (
        <Card className="p-10 text-center text-muted">
          {q ? "No orders match." : tab === "queue" ? "No orders waiting. New ones appear here automatically." : "Nothing here."}
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              now={now}
              timeZone={timeZone}
              staffName={o.taken_by ? (o.taken_by === me ? "you" : (staffNames[o.taken_by] ?? "staff")) : null}
              onResult={(r) => {
                setNotice(r);
                router.refresh();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AcceptingToggle({ accepting, closedMessage }: { accepting: boolean; closedMessage: string }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(closedMessage);
  const [error, setError] = useState<string | null>(null);

  const apply = (value: boolean) =>
    start(async () => {
      const r = await setAcceptingOrders(value, value ? null : message);
      setError(r.ok ? null : (r.error ?? "Couldn't update."));
      if (r.ok) setEditing(false);
    });

  if (editing) {
    return (
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <Input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} className="sm:w-72" aria-label="Message for students" />
        <Button variant="danger" size="sm" onClick={() => apply(false)} disabled={pending}>
          {pending ? <Spinner /> : null} Stop orders
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Keep open
        </Button>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Badge tone={accepting ? "success" : "danger"}>{accepting ? "Taking orders" : "Not taking orders"}</Badge>
      <Button variant="secondary" size="sm" onClick={() => (accepting ? setEditing(true) : apply(true))} disabled={pending}>
        {pending ? <Spinner /> : null} {accepting ? "Pause" : "Open"}
      </Button>
      {error ? <span className="text-sm text-danger">{error}</span> : null}
    </div>
  );
}

type Result = { tone: "danger" | "success"; text: string };

function OrderCard({
  order: o,
  now,
  timeZone,
  staffName,
  onResult,
}: {
  order: DashboardOrder;
  now: number;
  timeZone: string;
  staffName: string | null;
  onResult: (r: Result) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"cancel" | "collect" | null>(null);
  const [cancelCode, setCancelCode] = useState<CancelCode>("shop");
  const [reason, setReason] = useState("");

  async function transition(to: OrderStatus, extra: Record<string, unknown> = {}, label: string = to) {
    setBusy(label);
    try {
      const res = await fetch(`/api/shop/orders/${o.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, expectedFrom: o.status, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) onResult({ tone: "danger", text: `Token ${o.token}: ${json.error ?? "Couldn't update."}` });
      else if (json.order?.payment_status === "refund_pending") {
        onResult({ tone: "danger", text: `Token ${o.token} cancelled, but the refund failed. Retry it from the Refunds tab.` });
      } else onResult({ tone: "success", text: `Token ${o.token}: ${successText(label)}` });
      setDialog(null);
    } catch {
      onResult({ tone: "danger", text: "Network problem. Check the connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  async function retryRefund() {
    setBusy("refund");
    const res = await fetch(`/api/shop/orders/${o.id}/refund`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    onResult(res.ok ? { tone: "success", text: `Token ${o.token}: refund started.` } : { tone: "danger", text: json.error ?? "Refund failed." });
  }

  const unpaidCash = o.payment_method === "cash" && o.payment_status === "unpaid";
  const s = o.student;
  const since = o.status === "ready" ? o.ready_at : o.status === "taken" ? o.taken_at : o.queued_at;
  const canUndo = o.status === "collected" && o.collected_at && now - new Date(o.collected_at).getTime() < 15 * 60_000;

  return (
    <Card className={cx("p-4", o.status === "ready" && "border-success/40")}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="flex items-start gap-4 md:w-72 md:shrink-0">
          <div className="w-16 shrink-0 text-center">
            <div className="text-[11px] text-muted uppercase">Token</div>
            <div className="font-mono text-2xl font-bold tabular">{o.token}</div>
          </div>
          <div className="min-w-0">
            <p className="font-medium">{s?.full_name ?? "Unknown student"}</p>
            <p className="text-sm text-muted">
              {[s?.department, s?.section].filter(Boolean).join(" · ")} {s?.roll_number ? `· ${s.roll_number}` : ""}
            </p>
            {s?.phone ? (
              <a href={`tel:${s.phone}`} className="text-sm text-accent hover:underline">
                {s.phone}
              </a>
            ) : null}
            {o.alt_contact_name || o.alt_contact_phone ? (
              <p className="text-sm text-muted">
                Friend: {[o.alt_contact_name, o.alt_contact_phone].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {s && s.no_show_count > 0 ? (
              <Badge tone="warning" className="mt-1">
                {s.no_show_count} uncollected before
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {o.items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-surface-muted px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{describeJob(item)}</p>
                <p className="truncate text-sm text-muted" title={item.file_name}>
                  {o.items.length > 1 ? `${item.position}. ` : ""}
                  {item.file_name}
                  {item.file_kind !== "image" ? ` · ${item.file_pages} pages` : ""}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.pages_source !== "exact" ? (
                    <Badge tone="warning">
                      <AlertTriangle className="size-3" aria-hidden /> Page count {item.pages_source === "manual" ? "entered by student" : "from Word"} — check
                    </Badge>
                  ) : null}
                  {item.file?.is_encrypted ? <Badge tone="warning">Protected PDF</Badge> : null}
                  {item.color_mode === "color" ? <Badge tone="accent">Colour</Badge> : null}
                </div>
              </div>
              {item.file?.status === "ready" ? (
                <a
                  href={`/api/shop/items/${item.id}/download`}
                  className={cx(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm hover:bg-surface-muted",
                    item.downloaded_at && "text-muted",
                  )}
                  title={item.downloaded_at ? "Downloaded before" : "Download"}
                >
                  <Download className="size-4" aria-hidden /> {item.downloaded_at ? "Again" : "Download"}
                </a>
              ) : (
                <span className="text-xs text-muted">File removed</span>
              )}
            </div>
          ))}
          {o.note ? (
            <p className="rounded-lg border border-border px-3 py-2 text-sm">
              <span className="text-muted">Note: </span>
              {o.note}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 md:w-56 md:shrink-0 md:items-end">
          <div className="flex flex-wrap gap-1.5 md:justify-end">
            <StatusBadge status={o.status} />
            <PaymentBadge order={o} />
          </div>
          <p className="text-xs text-muted">
            {since ? `${formatTime(since, timeZone)} · ${formatAge(since, now)}` : ""}
            {staffName && (o.status === "taken" || o.status === "ready") ? ` · by ${staffName}` : ""}
          </p>
          {o.status === "cancelled" && o.cancel_reason ? <p className="text-xs text-muted md:text-right">{o.cancel_reason}</p> : null}
          {o.refund_error ? <p className="text-xs text-danger md:text-right">Refund error: {o.refund_error}</p> : null}

          <div className="flex flex-wrap gap-2 md:justify-end">
            {o.payment_status === "refund_pending" ? (
              <Button size="sm" variant="danger" onClick={retryRefund} disabled={!!busy}>
                {busy === "refund" ? <Spinner /> : null} Retry refund
              </Button>
            ) : null}
            {o.status === "placed" ? (
              <>
                <Button size="sm" onClick={() => transition("taken")} disabled={!!busy}>
                  {busy === "taken" ? <Spinner /> : null} Start printing
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDialog("cancel")} disabled={!!busy}>
                  Cancel
                </Button>
              </>
            ) : null}
            {o.status === "taken" ? (
              <>
                <Button size="sm" variant="success" onClick={() => transition("ready")} disabled={!!busy}>
                  {busy === "ready" ? <Spinner /> : null} Mark ready
                </Button>
                <Button size="sm" variant="secondary" onClick={() => transition("placed", {}, "release")} disabled={!!busy}>
                  {busy === "release" ? <Spinner /> : null} Back to queue
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDialog("cancel")} disabled={!!busy}>
                  Cancel
                </Button>
              </>
            ) : null}
            {o.status === "ready" ? (
              <>
                <Button
                  size="sm"
                  onClick={() => (unpaidCash ? setDialog("collect") : transition("collected"))}
                  disabled={!!busy}
                >
                  {busy === "collected" ? <Spinner /> : null} Hand over
                </Button>
                <Button size="sm" variant="secondary" onClick={() => transition("taken", {}, "reprint")} disabled={!!busy}>
                  {busy === "reprint" ? <Spinner /> : null} Reprint
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCancelCode("not_collected");
                    setDialog("cancel");
                  }}
                  disabled={!!busy}
                >
                  Not collected
                </Button>
              </>
            ) : null}
            {canUndo ? (
              <Button size="sm" variant="ghost" onClick={() => transition("ready", {}, "undo")} disabled={!!busy}>
                {busy === "undo" ? <Spinner /> : null} Undo hand-over
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {dialog === "collect" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/50 bg-warning-soft p-3">
          <p className="mr-auto text-sm">
            Collect <strong className="tabular">{formatRupees(o.amount_paise)}</strong> in cash from {s?.full_name ?? "the student"}
            {o.alt_contact_name ? ` or ${o.alt_contact_name}` : ""}.
          </p>
          <Button size="sm" variant="success" onClick={() => transition("collected", { cashReceived: true })} disabled={!!busy}>
            {busy === "collected" ? <Spinner /> : null} Cash received, hand over
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog(null)}>
            Back
          </Button>
        </div>
      ) : null}

      {dialog === "cancel" ? (
        <div className="mt-4 space-y-3 rounded-lg border border-danger/40 bg-danger-soft p-3">
          <div className="flex flex-wrap gap-3">
            <div className="w-full sm:w-56">
              <Select value={cancelCode} onChange={(e) => setCancelCode(e.target.value as CancelCode)} aria-label="Reason">
                {o.status === "ready" ? <option value="not_collected">Not collected</option> : null}
                <option value="file_problem">Problem with the file</option>
                <option value="shop">Other reason</option>
              </Select>
            </div>
            <Input
              className="flex-1"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder={cancelCode === "file_problem" ? "e.g. PDF asks for a password" : "Message for the student"}
              aria-label="Message for the student"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                transition("cancelled", { cancelCode, reason: reason || defaultReason(cancelCode) }, "cancelled")
              }
              disabled={!!busy || (cancelCode !== "not_collected" && reason.trim().length < 3)}
            >
              {busy === "cancelled" ? <Spinner /> : null} Cancel order
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog(null)}>
              Back
            </Button>
            <span className="text-xs text-muted">
              {o.payment_status === "paid" ? "The online payment will be refunded automatically. " : ""}The student is notified.
            </span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function defaultReason(code: CancelCode) {
  return code === "not_collected" ? "Not collected from the shop." : "Cancelled by the shop.";
}

function successText(label: string) {
  switch (label) {
    case "taken":
      return "printing started.";
    case "release":
      return "moved back to the queue.";
    case "reprint":
      return "moved back to printing.";
    case "ready":
      return "marked ready. The student has been notified.";
    case "undo":
      return "hand-over undone.";
    case "collected":
      return "handed over.";
    case "cancelled":
      return "cancelled. The student has been notified.";
    default:
      return "updated.";
  }
}
