"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { AlertTriangle, CheckCircle2, FileText, Image as ImageIcon, Minus, Plus, RotateCcw, Upload, X } from "lucide-react";
import { Alert, Button, Card, Input, Label, Segmented, Spinner, Textarea, cx } from "@/components/ui";
import { payWithRazorpay } from "@/lib/checkout-client";
import { ACCEPT_ATTRIBUTE, ACCEPTED_DESCRIPTION, classifyUpload } from "@/lib/files";
import { formatBytes, formatRate, formatRupees } from "@/lib/format";
import { computeQuote, type QuoteItemInput } from "@/lib/pricing";
import type { CheckoutParams, ColorMode, FileKind, Order, PageDetection, PaymentMethod, PriceTier, RangeType } from "@/lib/types";

export interface NewOrderSettings {
  maxFileMb: number;
  maxFilesPerOrder: number;
  maxCopies: number;
  maxPagesPerOrder: number;
  roundToRupee: boolean;
  onlineAvailable: boolean;
  cashAvailable: boolean;
  cashUnavailableReason: string | null;
  paymentWindowMinutes: number;
}

type Phase = "uploading" | "processing" | "ready" | "rejected" | "error";

interface Draft {
  key: string;
  file: File;
  name: string;
  size: number;
  phase: Phase;
  progress: number;
  fileId: string | null;
  kind: FileKind | null;
  detection: PageDetection | null;
  detectedPages: number | null;
  warning: string | null;
  error: string | null;
  colorMode: ColorMode;
  rangeType: RangeType;
  pageFrom: string;
  pageTo: string;
  copies: string;
  manualPages: string;
}

const RANGE_OPTIONS: { value: RangeType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "from", label: "From" },
  { value: "to", label: "Up to" },
  { value: "range", label: "Range" },
];

function toInt(v: string) {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) ? n : null;
}

function filePagesOf(d: Draft) {
  if (d.kind === "image") return 1;
  if (d.detection === "exact") return d.detectedPages;
  return toInt(d.manualPages);
}

function quoteInput(d: Draft): QuoteItemInput {
  return {
    filePages: filePagesOf(d),
    colorMode: d.colorMode,
    rangeType: d.kind === "image" ? "all" : d.rangeType,
    pageFrom: toInt(d.pageFrom),
    pageTo: toInt(d.pageTo),
    copies: toInt(d.copies) ?? 0,
  };
}

function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}). Please retry.`));
    xhr.onerror = () => reject(new Error("Upload interrupted. Check your connection and retry."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Please retry."));
    xhr.send(file);
  });
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

export function NewOrderForm({
  settings,
  tiers,
  defaultMethod,
}: {
  settings: NewOrderSettings;
  tiers: PriceTier[];
  defaultMethod: PaymentMethod;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod);
  const [altOpen, setAltOpen] = useState(false);
  const [altName, setAltName] = useState("");
  const [altPhone, setAltPhone] = useState("");
  const [note, setNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const busy = drafts.some((d) => d.phase === "uploading" || d.phase === "processing");

  // Warn before leaving while files are still uploading.
  useEffect(() => {
    if (!busy) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);

  async function upload(draft: Draft) {
    update(draft.key, { phase: "uploading", progress: 0, error: null });
    try {
      const start = await postJson("/api/uploads", { name: draft.name, size: draft.size });
      if (!start.res.ok) throw new Error(start.json.error ?? "Couldn't start the upload.");
      update(draft.key, { fileId: start.json.fileId, kind: start.json.kind });

      await putWithProgress(start.json.uploadUrl, draft.file, start.json.headers, (p) => update(draft.key, { progress: p }));
      update(draft.key, { phase: "processing", progress: 1 });

      const done = await postJson(`/api/uploads/${start.json.fileId}`);
      if (done.res.status === 422) {
        update(draft.key, { phase: "rejected", error: done.json.error ?? "This file can't be printed." });
        return;
      }
      if (!done.res.ok) throw new Error(done.json.error ?? "Couldn't process the file.");
      update(draft.key, {
        phase: "ready",
        detection: done.json.pageDetection,
        detectedPages: done.json.pages,
        warning: done.json.warning,
        manualPages: done.json.pageDetection === "estimate" && done.json.pages ? String(done.json.pages) : "",
      });
    } catch (e) {
      update(draft.key, { phase: "error", error: (e as Error).message });
    }
  }

  function addFiles(list: FileList | File[]) {
    setAddError(null);
    const files = Array.from(list);
    const room = settings.maxFilesPerOrder - drafts.length;
    if (files.length > room) {
      setAddError(`One order can have at most ${settings.maxFilesPerOrder} files.`);
    }
    const accepted: Draft[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      const type = classifyUpload(file.name);
      if (!type) {
        setAddError(`"${file.name}" isn't supported. Upload ${ACCEPTED_DESCRIPTION}.`);
        continue;
      }
      if (file.size === 0) {
        setAddError(`"${file.name}" is empty.`);
        continue;
      }
      if (file.size > settings.maxFileMb * 1024 * 1024) {
        setAddError(`"${file.name}" is ${formatBytes(file.size)}. Files can be up to ${settings.maxFileMb} MB.`);
        continue;
      }
      accepted.push({
        key: crypto.randomUUID(),
        file,
        name: file.name,
        size: file.size,
        phase: "uploading",
        progress: 0,
        fileId: null,
        kind: type.kind,
        detection: null,
        detectedPages: null,
        warning: null,
        error: null,
        colorMode: "bw",
        rangeType: "all",
        pageFrom: "",
        pageTo: "",
        copies: "1",
        manualPages: "",
      });
    }
    if (!accepted.length) return;
    setDrafts((ds) => [...ds, ...accepted]);
    // Upload a few at a time so phones on slow networks don't stall.
    void (async () => {
      const queue = [...accepted];
      const worker = async () => {
        for (let d = queue.shift(); d; d = queue.shift()) await upload(d);
      };
      await Promise.all([worker(), worker()]);
    })();
  }

  function remove(d: Draft) {
    setDrafts((ds) => ds.filter((x) => x.key !== d.key));
    if (d.fileId) void fetch(`/api/uploads/${d.fileId}`, { method: "DELETE" });
  }

  const ready = drafts.filter((d) => d.phase === "ready");
  const inputs = ready.map(quoteInput);
  const quoteOpts = { roundToRupee: settings.roundToRupee, maxCopies: settings.maxCopies, maxPagesPerOrder: settings.maxPagesPerOrder };
  const quotes = {
    online: computeQuote(inputs, tiers, "online", quoteOpts),
    cash: computeQuote(inputs, tiers, "cash", quoteOpts),
  };
  const quote = quotes[method];
  const itemErrors = new Map(ready.map((d, i) => [d.key, quote.errors[i]]));
  const pendingProblems = drafts.some((d) => d.phase !== "ready");
  const canSubmit =
    !submitting && drafts.length > 0 && !pendingProblems && quote.valid && (method === "online" ? settings.onlineAvailable : settings.cashAvailable);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { res, json } = await postJson("/api/orders", {
        paymentMethod: method,
        expectedAmountPaise: quote.totalPaise,
        altContactName: altOpen ? altName : null,
        altContactPhone: altOpen ? altPhone : null,
        note: note || null,
        items: ready.map((d) => ({
          fileId: d.fileId,
          colorMode: d.colorMode,
          rangeType: d.kind === "image" ? "all" : d.rangeType,
          pageFrom: toInt(d.pageFrom),
          pageTo: toInt(d.pageTo),
          copies: toInt(d.copies) ?? 1,
          manualPages: d.detection === "exact" || d.kind === "image" ? null : toInt(d.manualPages),
        })),
      });
      if (!res.ok) {
        setSubmitError(json.error ?? "Couldn't place the order.");
        if (json.code === "PRICE_CHANGED") router.refresh();
        setSubmitting(false);
        return;
      }
      const order = json.order as Order;
      if (order.payment_method === "online") {
        if (json.checkout) {
          const outcome = await payWithRazorpay(order.id, json.checkout as CheckoutParams);
          router.push(`/orders/${order.id}${outcome.status === "error" ? "?payment=error" : ""}`);
        } else {
          router.push(`/orders/${order.id}?payment=error`);
        }
        return;
      }
      router.push(`/orders/${order.id}`);
    } catch {
      setSubmitError("Network problem. Check your orders before trying again, in case it went through.");
      setSubmitting(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <Card className="p-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx(
              "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
              dragging ? "border-accent bg-accent-soft" : "border-border",
            )}
          >
            <Upload className="size-7 text-muted" aria-hidden />
            <div>
              <p className="font-medium">Add your files</p>
              <p className="text-sm text-muted">
                {ACCEPTED_DESCRIPTION} · up to {settings.maxFileMb} MB each
              </p>
            </div>
            <Button type="button" onClick={() => inputRef.current?.click()} disabled={drafts.length >= settings.maxFilesPerOrder}>
              Choose files
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {addError ? (
            <Alert tone="danger" className="mt-3">
              {addError}
            </Alert>
          ) : null}
        </Card>

        {drafts.map((d, index) => (
          <DraftCard
            key={d.key}
            draft={d}
            index={index}
            maxCopies={settings.maxCopies}
            error={itemErrors.get(d.key) ?? null}
            onChange={(patch) => update(d.key, patch)}
            onRemove={() => remove(d)}
            onRetry={() => upload(d)}
          />
        ))}

        {drafts.length > 0 ? (
          <Card className="space-y-4 p-4">
            <div>
              <button
                type="button"
                className="text-sm font-medium text-accent hover:underline"
                onClick={() => setAltOpen((v) => !v)}
                aria-expanded={altOpen}
              >
                {altOpen ? "− Remove alternate contact" : "+ A friend will collect it"}
              </button>
              {altOpen ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="alt-name">Friend&apos;s name</Label>
                    <Input id="alt-name" value={altName} onChange={(e) => setAltName(e.target.value)} maxLength={80} />
                  </div>
                  <div>
                    <Label htmlFor="alt-phone">Friend&apos;s mobile</Label>
                    <Input
                      id="alt-phone"
                      type="tel"
                      inputMode="tel"
                      value={altPhone}
                      onChange={(e) => setAltPhone(e.target.value)}
                      maxLength={16}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <div>
              <Label htmlFor="note" hint="(optional)">
                Note for the shop
              </Label>
              <Textarea
                id="note"
                rows={2}
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. print file 2 first"
              />
              <p className="mt-1 text-xs text-muted">Binding and other extras aren&apos;t available in the pilot yet.</p>
            </div>
          </Card>
        ) : null}
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <Card className="space-y-4 p-4">
          <h2 className="font-semibold">Payment</h2>
          <Segmented<PaymentMethod>
            name="Payment method"
            value={method}
            onChange={setMethod}
            options={[
              {
                value: "online",
                disabled: !settings.onlineAvailable,
                label: (
                  <span className="flex flex-col leading-tight">
                    <span>Pay online</span>
                    {quotes.online.valid ? <span className="text-xs text-muted tabular">{formatRupees(quotes.online.totalPaise)}</span> : null}
                  </span>
                ),
              },
              {
                value: "cash",
                disabled: !settings.cashAvailable,
                label: (
                  <span className="flex flex-col leading-tight">
                    <span>Pay at shop</span>
                    {quotes.cash.valid ? <span className="text-xs text-muted tabular">{formatRupees(quotes.cash.totalPaise)}</span> : null}
                  </span>
                ),
              },
            ]}
          />
          <p className="text-xs text-muted">
            {method === "online"
              ? `UPI, cards or netbanking. Your order joins the queue as soon as payment goes through (within ${settings.paymentWindowMinutes} min).`
              : "Your order joins the queue now, marked unpaid. Pay in cash when you collect."}
          </p>
          {!settings.onlineAvailable ? <p className="text-xs text-muted">Online payment is not available right now.</p> : null}
          {!settings.cashAvailable && settings.cashUnavailableReason ? (
            <p className="text-xs text-warning">{settings.cashUnavailableReason}</p>
          ) : null}

          <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
            {(["bw", "color"] as const).map((mode) =>
              quote.pages[mode] > 0 ? (
                <div key={mode} className="flex justify-between gap-2">
                  <dt className="text-muted">
                    {quote.pages[mode]} {mode === "bw" ? "B&W" : "colour"} page{quote.pages[mode] === 1 ? "" : "s"}
                    {quote.rates[mode] != null ? ` × ${formatRate(quote.rates[mode]!)}` : ""}
                  </dt>
                  <dd className="tabular">
                    {quote.rates[mode] != null ? formatRupees(quote.pages[mode] * quote.rates[mode]!) : "—"}
                  </dd>
                </div>
              ) : null,
            )}
            {quote.roundingPaise > 0 ? (
              <div className="flex justify-between gap-2 text-muted">
                <dt>Rounded to the rupee</dt>
                <dd className="tabular">+{formatRupees(quote.roundingPaise)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-2 pt-1 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{quote.valid ? formatRupees(quote.totalPaise) : "—"}</dd>
            </div>
          </dl>

          {quote.orderError ? <Alert tone="danger">{quote.orderError}</Alert> : null}
          {submitError ? <Alert tone="danger">{submitError}</Alert> : null}

          <Button type="button" size="lg" className="w-full" disabled={!canSubmit} onClick={submit}>
            {submitting ? <Spinner /> : null}
            {method === "online" ? "Place order & pay" : "Place order"}
          </Button>
          {drafts.length === 0 ? (
            <p className="text-center text-xs text-muted">Add a file to see the price.</p>
          ) : busy ? (
            <p className="text-center text-xs text-muted">Waiting for uploads to finish…</p>
          ) : pendingProblems ? (
            <p className="text-center text-xs text-danger">Remove or retry the files marked in red.</p>
          ) : null}
        </Card>
      </aside>
    </div>
  );
}

function DraftCard({
  draft: d,
  index,
  maxCopies,
  error,
  onChange,
  onRemove,
  onRetry,
}: {
  draft: Draft;
  index: number;
  maxCopies: number;
  error: string | null;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const isImage = d.kind === "image";
  const Icon = isImage ? ImageIcon : FileText;
  const copies = toInt(d.copies) ?? 1;
  const needsPages = d.phase === "ready" && !isImage && d.detection !== "exact";
  const id = `file-${d.key}`;

  return (
    <Card className={cx("p-4", (d.phase === "error" || d.phase === "rejected") && "border-danger/50")}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-muted text-muted">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={d.name}>
            <span className="mr-1 text-muted">{index + 1}.</span>
            {d.name}
          </p>
          <p className="text-sm text-muted">
            {formatBytes(d.size)}
            {d.phase === "ready" && !needsPages ? (
              <>
                {" · "}
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="size-3.5" aria-hidden />
                  {isImage ? "1 page" : `${d.detectedPages} pages detected`}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <button type="button" onClick={onRemove} className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground" aria-label={`Remove ${d.name}`}>
          <X className="size-4" />
        </button>
      </div>

      {d.phase === "uploading" || d.phase === "processing" ? (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${Math.round((d.phase === "processing" ? 1 : d.progress) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 flex items-center gap-2 text-xs text-muted">
            <Spinner className="size-3" />
            {d.phase === "processing" ? "Checking the file and counting pages…" : `Uploading… ${Math.round(d.progress * 100)}%`}
          </p>
        </div>
      ) : null}

      {d.phase === "error" || d.phase === "rejected" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Alert tone="danger" className="flex-1">
            {d.error}
          </Alert>
          {d.phase === "error" ? (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              <RotateCcw className="size-3.5" aria-hidden /> Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      {d.phase === "ready" ? (
        <div className="mt-4 space-y-4">
          {d.warning ? (
            <Alert tone="warning" className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{d.warning}</span>
            </Alert>
          ) : null}

          {needsPages ? (
            <div className="max-w-48">
              <Label htmlFor={`${id}-pages`}>Pages in this file</Label>
              <Input
                id={`${id}-pages`}
                inputMode="numeric"
                value={d.manualPages}
                onChange={(e) => onChange({ manualPages: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                placeholder="e.g. 12"
              />
            </div>
          ) : null}

          <div>
            <Label>Print type</Label>
            <Segmented<ColorMode>
              name="Print type"
              value={d.colorMode}
              onChange={(v) => onChange({ colorMode: v })}
              options={[
                { value: "bw", label: "Black & white" },
                { value: "color", label: "Colour" },
              ]}
            />
          </div>

          {!isImage ? (
            <div>
              <Label>Pages</Label>
              <Segmented<RangeType>
                name="Pages to print"
                value={d.rangeType}
                onChange={(v) => onChange({ rangeType: v })}
                options={RANGE_OPTIONS}
              />
              {d.rangeType !== "all" ? (
                <div className="mt-3 flex items-end gap-3">
                  {d.rangeType === "from" || d.rangeType === "range" ? (
                    <div className="w-28">
                      <Label htmlFor={`${id}-from`}>From page</Label>
                      <Input
                        id={`${id}-from`}
                        inputMode="numeric"
                        value={d.pageFrom}
                        onChange={(e) => onChange({ pageFrom: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                      />
                    </div>
                  ) : null}
                  {d.rangeType === "to" || d.rangeType === "range" ? (
                    <div className="w-28">
                      <Label htmlFor={`${id}-to`}>{d.rangeType === "to" ? "Up to page" : "To page"}</Label>
                      <Input
                        id={`${id}-to`}
                        inputMode="numeric"
                        value={d.pageTo}
                        onChange={(e) => onChange({ pageTo: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                      />
                    </div>
                  ) : null}
                  {filePagesOf(d) ? <p className="pb-2.5 text-sm text-muted">of {filePagesOf(d)}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <Label htmlFor={`${id}-copies`}>Copies</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="size-10 px-0"
                aria-label="One copy fewer"
                disabled={copies <= 1}
                onClick={() => onChange({ copies: String(Math.max(1, copies - 1)) })}
              >
                <Minus className="size-4" />
              </Button>
              <div className="w-16">
                <Input
                  id={`${id}-copies`}
                  inputMode="numeric"
                  className="text-center tabular"
                  value={d.copies}
                  onChange={(e) => onChange({ copies: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="size-10 px-0"
                aria-label="One more copy"
                disabled={copies >= maxCopies}
                onClick={() => onChange({ copies: String(Math.min(maxCopies, copies + 1)) })}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      ) : null}
    </Card>
  );
}
