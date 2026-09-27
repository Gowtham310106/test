"use client";

import { useActionState, useTransition } from "react";
import { Alert, Badge, Button, Card, Input, Label, Select, Spinner, Textarea } from "@/components/ui";
import type { AppSettings, UserRole } from "@/lib/types";
import { addStaff, removeStaff, saveSettings, type SettingsState } from "./actions";

function NumberField({ name, label, hint, value, min, max }: { name: string; label: string; hint?: string; value: number; min: number; max: number }) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" min={min} max={max} defaultValue={value} required />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function SettingsForm({ settings, gatewayConfigured }: { settings: AppSettings; gatewayConfigured: boolean }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSettings, {});

  return (
    <form action={action} className="space-y-4">
      <Card className="space-y-4 p-4">
        <h2 className="font-semibold">Shop</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="shop_name">Shop name</Label>
            <Input id="shop_name" name="shop_name" defaultValue={settings.shop_name} required maxLength={60} />
          </div>
          <div>
            <Label htmlFor="closed_message">Message when not taking orders</Label>
            <Input id="closed_message" name="closed_message" defaultValue={settings.closed_message} required maxLength={200} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="font-semibold">Who can sign in</h2>
        <div>
          <Label htmlFor="allowed_email_domains">College email domains</Label>
          <Textarea
            id="allowed_email_domains"
            name="allowed_email_domains"
            rows={2}
            defaultValue={settings.allowed_email_domains.join(", ")}
            placeholder="college.edu.in"
          />
          {settings.allowed_email_domains.length === 0 ? (
            <Alert tone="danger" className="mt-2">
              No domain set: anyone with any email can sign up. Add the college domain before the pilot starts.
            </Alert>
          ) : (
            <p className="mt-1 text-xs text-muted">Subdomains are included (e.g. students.college.edu.in). Staff below can always sign in.</p>
          )}
        </div>
        <div>
          <Label htmlFor="departments">Departments (for the sign-up form)</Label>
          <Textarea id="departments" name="departments" rows={2} defaultValue={settings.departments.join(", ")} />
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="font-semibold">Orders</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField name="max_file_mb" label="Max file size (MB)" value={settings.max_file_mb} min={1} max={100} />
          <NumberField name="max_files_per_order" label="Max files per order" value={settings.max_files_per_order} min={1} max={30} />
          <NumberField name="max_pages_per_order" label="Max printed pages per order" value={settings.max_pages_per_order} min={10} max={20000} />
          <NumberField name="max_copies" label="Max copies per file" value={settings.max_copies} min={1} max={500} />
          <NumberField name="max_active_orders" label="Open orders per student" value={settings.max_active_orders} min={1} max={50} />
          <NumberField name="file_retention_days" label="Delete files after (days)" value={settings.file_retention_days} min={1} max={90} />
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="font-semibold">Payments</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="online_payments_enabled" defaultChecked={settings.online_payments_enabled} className="size-4" />
          Accept online payments (UPI / card)
        </label>
        {!gatewayConfigured ? (
          <Alert tone="warning">Razorpay keys are not set on the server, so online payment stays off until they are added.</Alert>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="round_to_rupee" defaultChecked={settings.round_to_rupee} className="size-4" />
          Round totals up to the next rupee (no change in paise at the counter)
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField
            name="max_unpaid_orders"
            label="Unpaid pay-at-shop orders per student"
            hint="0 turns pay at shop off."
            value={settings.max_unpaid_orders}
            min={0}
            max={20}
          />
          <NumberField
            name="cash_block_after_no_shows"
            label="Block pay-at-shop after uncollected orders"
            hint="0 never blocks."
            value={settings.cash_block_after_no_shows}
            min={0}
            max={50}
          />
          <NumberField
            name="payment_window_minutes"
            label="Minutes to finish online payment"
            value={settings.payment_window_minutes}
            min={5}
            max={1440}
          />
        </div>
      </Card>

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">Settings saved.</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : null} Save settings
      </Button>
    </form>
  );
}

export function StaffManager({ staff, selfEmail }: { staff: { email: string; role: UserRole }[]; selfEmail: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(addStaff, {});
  const [removing, start] = useTransition();

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="font-semibold">Shop staff</h2>
        <p className="mt-1 text-sm text-muted">
          These emails get the shop dashboard when they sign in (any email domain). Admins can also change settings.
        </p>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {staff.map((s) => (
          <li key={s.email} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{s.email}</span>
            <span className="flex items-center gap-2">
              <Badge tone={s.role === "admin" ? "accent" : "neutral"}>{s.role}</Badge>
              {s.email !== selfEmail ? (
                <Button variant="ghost" size="sm" disabled={removing} onClick={() => start(async () => void (await removeStaff(s.email, selfEmail)))}>
                  Remove
                </Button>
              ) : null}
            </span>
          </li>
        ))}
        {staff.length === 0 ? <li className="px-3 py-2 text-sm text-muted">No staff yet.</li> : null}
      </ul>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Label htmlFor="staff-email">Email</Label>
          <Input id="staff-email" name="email" type="email" required />
        </div>
        <div className="w-32">
          <Label htmlFor="staff-role">Role</Label>
          <Select id="staff-role" name="role" defaultValue="staff">
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null} Add
        </Button>
      </form>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
    </Card>
  );
}
