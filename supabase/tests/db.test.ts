import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { computeQuote, type QuoteItemInput } from "../../src/lib/pricing";
import type { PriceTier } from "../../src/lib/types";
import {
  asAnon,
  asService,
  asSuperuser,
  asUser,
  createDb,
  createFile,
  createStudent,
  errorOf,
  signUp,
  type Db,
} from "./harness";

type Row = Record<string, unknown>;

async function one<T = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}

async function settings(db: Db, patch: string) {
  await asSuperuser(db);
  await db.exec(`update public.app_settings set ${patch} where id = 1`);
}

function items(list: Row[]) {
  return JSON.stringify(list);
}

async function placeOrder(db: Db, studentId: string, method: "cash" | "online", list: Row[], expected: number | null = null) {
  await asUser(db, studentId);
  return one<Row>(db, "select * from public.place_order($1, $2::jsonb, $3)", [method, items(list), expected]);
}

async function staffTransition(db: Db, staffId: string, orderId: string, to: string, expectedFrom: string | null, extra: Row = {}) {
  await asUser(db, staffId);
  return one<Row>(db, "select * from public.staff_transition_order($1, $2, $3, $4, $5, $6)", [
    orderId,
    to,
    expectedFrom,
    extra.cash ?? false,
    extra.code ?? null,
    extra.reason ?? null,
  ]);
}

async function createStaff(db: Db, email: string, role: "staff" | "admin" = "staff") {
  await asSuperuser(db);
  await db.query("insert into public.staff_allowlist (email, role) values ($1, $2)", [email, role]);
  const id = await signUp(db, email);
  await asUser(db, id);
  await db.query("select public.save_profile($1)", ["Shop Staff"]);
  return id;
}

describe("sign-up and profiles", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createDb();
    await settings(db, "allowed_email_domains = '{college.edu.in}'");
  });

  it("only lets college emails (and subdomains) sign up", async () => {
    expect(await errorOf(signUp(db, "outsider@gmail.com"))).toContain("EMAIL_NOT_ALLOWED");
    expect(await errorOf(signUp(db, "fake@notcollege.edu.in"))).toContain("EMAIL_NOT_ALLOWED");
    await expect(signUp(db, "priya@college.edu.in")).resolves.toBeTruthy();
    await expect(signUp(db, "arun@students.college.edu.in")).resolves.toBeTruthy();
    await expect(signUp(db, "UPPER@College.Edu.In")).resolves.toBeTruthy();
  });

  it("gives allowlisted staff their role whatever their domain", async () => {
    const id = await createStaff(db, "owner@gmail.com", "admin");
    const p = await one(db, "select role from public.profiles where id = $1", [id]);
    expect(p.role).toBe("admin");
  });

  it("promotes and demotes existing accounts when the allowlist changes", async () => {
    const id = await signUp(db, "helper@college.edu.in");
    await asSuperuser(db);
    await db.exec("insert into public.staff_allowlist (email) values ('helper@college.edu.in')");
    expect((await one(db, "select role from public.profiles where id = $1", [id])).role).toBe("staff");
    await db.exec("delete from public.staff_allowlist where email = 'helper@college.edu.in'");
    expect((await one(db, "select role from public.profiles where id = $1", [id])).role).toBe("student");
  });

  it("anonymous visitors can check an email before sign-in", async () => {
    await asAnon(db);
    expect((await one(db, "select public.email_domain_allowed('a@college.edu.in') as ok")).ok).toBe(true);
    expect((await one(db, "select public.email_domain_allowed('a@gmail.com') as ok")).ok).toBe(false);
  });

  it("validates and normalises profile details", async () => {
    const id = await signUp(db, "divya@college.edu.in");
    await asUser(db, id);
    expect(await errorOf(db.query("select public.save_profile('Divya S', '21cs045', 'CSE', 'C', null)"))).toContain(
      "PROFILE_INCOMPLETE",
    );
    expect(await errorOf(db.query("select public.save_profile('Divya S', '21cs045', 'CSE', 'C', '12345')"))).toContain(
      "INVALID_PHONE",
    );
    const p = await one(db, "select * from public.save_profile('  Divya   S ', '21 cs 045', 'cse', 'c', '+91 98765 43210')");
    expect(p).toMatchObject({ full_name: "Divya S", roll_number: "21CS045", department: "CSE", section: "C", phone: "9876543210" });
  });

  it("locks the roll number once set and keeps it unique", async () => {
    const a = await signUp(db, "karthik@college.edu.in");
    await asUser(db, a);
    await db.query("select public.save_profile('Karthik M', '21EE010', 'EEE', 'A', '9876500000')");
    expect(await errorOf(db.query("select public.save_profile('Karthik M', '21EE011', 'EEE', 'A', '9876500000')"))).toContain(
      "ROLL_NUMBER_LOCKED",
    );
    const b = await signUp(db, "impostor@college.edu.in");
    await asUser(db, b);
    expect(await errorOf(db.query("select public.save_profile('Someone', '21ee010', 'EEE', 'A', '9876500001')"))).toContain(
      "ROLL_NUMBER_TAKEN",
    );
  });

  it("students cannot make themselves staff", async () => {
    const id = await signUp(db, "sneaky@college.edu.in");
    await asUser(db, id);
    expect(await errorOf(db.query("update public.profiles set role = 'admin' where id = $1", [id]))).toMatch(/permission denied/);
    expect(await errorOf(db.query("insert into public.staff_allowlist (email, role) values ('sneaky@college.edu.in', 'admin')"))).toMatch(
      /row-level security|permission denied/,
    );
  });
});

describe("placing orders", () => {
  let db: Db;
  let student: string;

  beforeAll(async () => {
    db = await createDb();
  });

  beforeEach(async () => {
    await settings(
      db,
      "accepting_orders = true, max_active_orders = 5, max_unpaid_orders = 2, cash_block_after_no_shows = 3, round_to_rupee = true, online_payments_enabled = true",
    );
    student = await createStudent(db);
  });

  it("creates a queued cash order with the proposal's example price", async () => {
    const file = await createFile(db, student, { pages: 42 });
    const order = await placeOrder(db, student, "cash", [
      { file_id: file, color_mode: "bw", range_type: "range", page_from: 1, page_to: 30, copies: 2 },
    ]);
    expect(order).toMatchObject({ status: "placed", payment_status: "unpaid", amount_paise: 6000, total_printed_pages: 60 });
    expect(order.token as number).toBeGreaterThanOrEqual(1000);
    expect(order.token as number).toBeLessThanOrEqual(9999);
    expect(order.queued_at).not.toBeNull();

    const item = await one(db, "select * from public.order_items where order_id = $1", [order.id]);
    expect(item).toMatchObject({ page_from: 1, page_to: 30, copies: 2, printed_pages: 60, rate_paise: 100, pages_source: "exact" });
    const event = await one(db, "select * from public.order_events where order_id = $1", [order.id]);
    expect(event).toMatchObject({ from_status: null, to_status: "placed", actor_id: student });
  });

  it("creates online orders hidden from the queue until paid", async () => {
    const file = await createFile(db, student, { pages: 3 });
    const order = await placeOrder(db, student, "online", [{ file_id: file, color_mode: "bw", copies: 1 }]);
    expect(order).toMatchObject({ status: "awaiting_payment", amount_paise: 400, subtotal_paise: 315, queued_at: null });
  });

  it("rejects a stale preview price so the student can re-confirm", async () => {
    const file = await createFile(db, student, { pages: 10 });
    const err = await errorOf(placeOrder(db, student, "cash", [{ file_id: file, color_mode: "bw", copies: 1 }], 900));
    expect(err).toContain("PRICE_CHANGED");
    await expect(placeOrder(db, student, "cash", [{ file_id: file, color_mode: "bw", copies: 1 }], 1000)).resolves.toBeTruthy();
  });

  it("never trusts page counts it could count itself", async () => {
    const file = await createFile(db, student, { pages: 50 });
    const order = await placeOrder(db, student, "cash", [{ file_id: file, color_mode: "bw", copies: 1, manual_pages: 1 }]);
    expect(order.total_printed_pages).toBe(50);
  });

  it("uses the student's count for Word files, flagged for the shop", async () => {
    const estimate = await createFile(db, student, { kind: "docx", pages: 12 });
    const unknown = await createFile(db, student, { kind: "doc", pages: null });
    expect(await errorOf(placeOrder(db, student, "cash", [{ file_id: unknown, color_mode: "bw", copies: 1 }]))).toContain(
      "PAGES_REQUIRED",
    );
    const order = await placeOrder(db, student, "cash", [
      { file_id: estimate, color_mode: "bw", copies: 1 },
      { file_id: unknown, color_mode: "bw", copies: 1, manual_pages: 7 },
      { file_id: estimate, color_mode: "bw", copies: 1, manual_pages: 14 },
    ]);
    const rows = (await db.query<Row>("select pages_source, file_pages from public.order_items where order_id = $1 order by position", [order.id])).rows;
    expect(rows).toEqual([
      { pages_source: "estimate", file_pages: 12 },
      { pages_source: "manual", file_pages: 7 },
      { pages_source: "manual", file_pages: 14 },
    ]);
  });

  it("prints photos as one page whatever range is sent", async () => {
    const photo = await createFile(db, student, { kind: "image" });
    const order = await placeOrder(db, student, "cash", [
      { file_id: photo, color_mode: "color", range_type: "range", page_from: 1, page_to: 9, copies: 2 },
    ]);
    expect(order).toMatchObject({ total_printed_pages: 2, amount_paise: 2000 });
  });

  it("rejects bad ranges, copies and other students' files", async () => {
    const file = await createFile(db, student, { pages: 10 });
    const bad = (item: Row) => errorOf(placeOrder(db, student, "cash", [{ file_id: file, color_mode: "bw", copies: 1, ...item }]));
    expect(await bad({ range_type: "range", page_from: 5, page_to: 2 })).toContain("INVALID_PAGE_RANGE");
    expect(await bad({ range_type: "to", page_to: 11 })).toContain("INVALID_PAGE_RANGE");
    expect(await bad({ range_type: "from" })).toContain("INVALID_PAGE_RANGE");
    expect(await bad({ copies: 0 })).toContain("INVALID_COPIES");
    expect(await bad({ copies: 51 })).toContain("INVALID_COPIES");

    const other = await createStudent(db);
    const theirs = await createFile(db, other, { pages: 1 });
    expect(await errorOf(placeOrder(db, student, "cash", [{ file_id: theirs, color_mode: "bw", copies: 1 }]))).toContain(
      "FILE_NOT_READY",
    );
    expect(await errorOf(placeOrder(db, student, "cash", []))).toContain("NO_ITEMS");
  });

  it("refuses files that are still uploading or were rejected", async () => {
    const file = await createFile(db, student, { pages: 2 });
    await asSuperuser(db);
    await db.query("update public.files set status = 'pending' where id = $1", [file]);
    expect(await errorOf(placeOrder(db, student, "cash", [{ file_id: file, color_mode: "bw", copies: 1 }]))).toContain(
      "FILE_NOT_READY",
    );
  });

  it("enforces shop closed, open-order and unpaid-order limits", async () => {
    const file = await createFile(db, student, { pages: 1 });
    const one_ = [{ file_id: file, color_mode: "bw", copies: 1 }];

    await settings(db, "accepting_orders = false, closed_message = 'Closed for Pongal'");
    expect(await errorOf(placeOrder(db, student, "cash", one_))).toContain("SHOP_CLOSED");
    await settings(db, "accepting_orders = true");

    await placeOrder(db, student, "cash", one_);
    await placeOrder(db, student, "cash", one_);
    expect(await errorOf(placeOrder(db, student, "cash", one_))).toContain("TOO_MANY_UNPAID_ORDERS");
    // Paying online is still allowed.
    await placeOrder(db, student, "online", one_);
    await placeOrder(db, student, "online", one_);
    await placeOrder(db, student, "online", one_);
    expect(await errorOf(placeOrder(db, student, "online", one_))).toContain("TOO_MANY_ACTIVE_ORDERS");

    await settings(db, "max_unpaid_orders = 0");
    const fresh = await createStudent(db);
    const f2 = await createFile(db, fresh, { pages: 1 });
    expect(await errorOf(placeOrder(db, fresh, "cash", [{ file_id: f2, color_mode: "bw", copies: 1 }]))).toContain("CASH_DISABLED");
  });

  it("turns off pay-at-shop for students who keep not collecting", async () => {
    const staff = await createStaff(db, `staff${Date.now()}@shop.in`);
    const file = await createFile(db, student, { pages: 1 });
    for (let i = 0; i < 3; i++) {
      const o = await placeOrder(db, student, "cash", [{ file_id: file, color_mode: "bw", copies: 1 }]);
      await staffTransition(db, staff, o.id as string, "taken", "placed");
      await staffTransition(db, staff, o.id as string, "ready", "taken");
      await staffTransition(db, staff, o.id as string, "cancelled", "ready", { code: "not_collected" });
    }
    expect(await errorOf(placeOrder(db, student, "cash", [{ file_id: file, color_mode: "bw", copies: 1 }]))).toContain(
      "CASH_BLOCKED",
    );
    await expect(placeOrder(db, student, "online", [{ file_id: file, color_mode: "bw", copies: 1 }])).resolves.toBeTruthy();
  });

  it("caps very large orders", async () => {
    await settings(db, "max_pages_per_order = 100");
    const file = await createFile(db, student, { pages: 60 });
    expect(await errorOf(placeOrder(db, student, "cash", [{ file_id: file, color_mode: "bw", copies: 2 }]))).toContain(
      "ORDER_TOO_LARGE",
    );
    await settings(db, "max_pages_per_order = 2000");
  });

  it("requires a completed profile", async () => {
    const id = await signUp(db, `new${Date.now()}@college.edu`);
    const file = await createFile(db, id, { pages: 1 });
    expect(await errorOf(placeOrder(db, id, "cash", [{ file_id: file, color_mode: "bw", copies: 1 }]))).toContain(
      "PROFILE_INCOMPLETE",
    );
  });
});

describe("pricing parity between the browser preview and the database", () => {
  let db: Db;
  let student: string;
  let tiers: PriceTier[];

  beforeAll(async () => {
    db = await createDb();
    await settings(db, "max_active_orders = 50, max_unpaid_orders = 20");
    student = await createStudent(db);
    tiers = (await db.query<PriceTier>("select color_mode, min_pages, rate_cash_paise, rate_online_paise from public.price_tiers")).rows;
  });

  it("agrees on randomised orders, both payment methods, rounding on and off", async () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };

    for (let round = 0; round < 40; round++) {
      const roundToRupee = round % 2 === 0;
      await settings(db, `round_to_rupee = ${roundToRupee}`);
      const count = 1 + rand(4);
      const sqlItems: Row[] = [];
      const tsItems: QuoteItemInput[] = [];
      for (let i = 0; i < count; i++) {
        const pages = 1 + rand(80);
        const file = await createFile(db, student, { pages });
        const rangeType = (["all", "from", "to", "range"] as const)[rand(4)];
        const from = 1 + rand(pages);
        const to = from + rand(pages - from + 1);
        const colorMode = rand(3) === 0 ? "color" : "bw";
        const copies = 1 + rand(5);
        const pageFrom = rangeType === "from" || rangeType === "range" ? from : null;
        const pageTo = rangeType === "to" || rangeType === "range" ? to : null;
        sqlItems.push({ file_id: file, color_mode: colorMode, range_type: rangeType, page_from: pageFrom, page_to: pageTo, copies });
        tsItems.push({ filePages: pages, colorMode, rangeType, pageFrom, pageTo, copies });
      }
      for (const method of ["cash", "online"] as const) {
        const quote = computeQuote(tsItems, tiers, method, { roundToRupee });
        expect(quote.valid).toBe(true);
        const order = await placeOrder(db, student, method, sqlItems, quote.totalPaise);
        expect(order.amount_paise).toBe(quote.totalPaise);
        expect(order.subtotal_paise).toBe(quote.subtotalPaise);
        await asSuperuser(db);
        await db.query("update public.orders set status = 'cancelled', cancel_code = 'shop' where id = $1", [order.id]);
      }
    }
  });
});

describe("tokens", () => {
  it("stay unique among open orders when the counter wraps around", async () => {
    const db = await createDb();
    await settings(db, "max_active_orders = 50, max_unpaid_orders = 20");
    const student = await createStudent(db);
    const file = await createFile(db, student, { pages: 1 });
    const item = [{ file_id: file, color_mode: "bw", copies: 1 }];

    const first = await placeOrder(db, student, "cash", item);
    expect(first.token).toBe(1000);
    await asSuperuser(db);
    await db.exec("select setval('public.order_token_seq', 9999)");
    const wrapped = await placeOrder(db, student, "cash", item);
    // 1000 is still open, so the wrap skips to 1001.
    expect(wrapped.token).toBe(1001);

    await asSuperuser(db);
    await db.query("update public.orders set status = 'cancelled', cancel_code = 'shop' where id = $1", [first.id]);
    await db.exec("select setval('public.order_token_seq', 9999)");
    const reused = await placeOrder(db, student, "cash", item);
    expect(reused.token).toBe(1000);
  });
});

describe("shop workflow", () => {
  let db: Db;
  let student: string;
  let staff: string;
  let staff2: string;

  beforeAll(async () => {
    db = await createDb();
    await settings(db, "max_active_orders = 50, max_unpaid_orders = 20");
    staff = await createStaff(db, "staff1@shop.in");
    staff2 = await createStaff(db, "staff2@shop.in");
    student = await createStudent(db);
  });

  async function cashOrder() {
    const file = await createFile(db, student, { pages: 5 });
    return placeOrder(db, student, "cash", [{ file_id: file, color_mode: "bw", copies: 1 }]);
  }

  it("moves an order through the full journey", async () => {
    const o = await cashOrder();
    const taken = await staffTransition(db, staff, o.id as string, "taken", "placed");
    expect(taken).toMatchObject({ status: "taken", taken_by: staff });
    const ready = await staffTransition(db, staff, o.id as string, "ready", "taken");
    expect(ready.ready_at).not.toBeNull();
    expect(await errorOf(staffTransition(db, staff, o.id as string, "collected", "ready"))).toContain("PAYMENT_PENDING");
    const done = await staffTransition(db, staff, o.id as string, "collected", "ready", { cash: true });
    expect(done).toMatchObject({ status: "collected", payment_status: "paid", collected_by: staff });

    const events = (await db.query<Row>("select from_status, to_status, actor_id from public.order_events where order_id = $1 order by id", [o.id])).rows;
    expect(events.map((e) => e.to_status)).toEqual(["placed", "taken", "ready", "collected"]);
    expect(events[3].actor_id).toBe(staff);
  });

  it("stops two staff acting on the same order at once", async () => {
    const o = await cashOrder();
    await staffTransition(db, staff, o.id as string, "taken", "placed");
    const err = await errorOf(staffTransition(db, staff2, o.id as string, "taken", "placed"));
    expect(err).toContain("STATUS_CHANGED");
  });

  it("allows undoing a mistaken hand-over for 15 minutes, and reverts the cash", async () => {
    const o = await cashOrder();
    await staffTransition(db, staff, o.id as string, "taken", "placed");
    await staffTransition(db, staff, o.id as string, "ready", "taken");
    await staffTransition(db, staff, o.id as string, "collected", "ready", { cash: true });
    const undone = await staffTransition(db, staff, o.id as string, "ready", "collected");
    expect(undone).toMatchObject({ status: "ready", payment_status: "unpaid", collected_at: null });

    await staffTransition(db, staff, o.id as string, "collected", "ready", { cash: true });
    await asSuperuser(db);
    await db.query("update public.orders set collected_at = now() - interval '20 minutes' where id = $1", [o.id]);
    expect(await errorOf(staffTransition(db, staff, o.id as string, "ready", "collected"))).toContain("UNDO_WINDOW_PASSED");
  });

  it("rejects transitions that skip steps", async () => {
    const o = await cashOrder();
    expect(await errorOf(staffTransition(db, staff, o.id as string, "ready", "placed"))).toContain("INVALID_TRANSITION");
    expect(await errorOf(staffTransition(db, staff, o.id as string, "collected", "placed"))).toContain("INVALID_TRANSITION");
    expect(await errorOf(staffTransition(db, staff, o.id as string, "cancelled", "placed", { code: "not_collected" }))).toContain(
      "INVALID_CANCEL_CODE",
    );
    expect(await errorOf(staffTransition(db, staff, o.id as string, "cancelled", "placed", { code: "student" }))).toContain(
      "INVALID_CANCEL_CODE",
    );
  });

  it("does not let students run staff actions", async () => {
    const o = await cashOrder();
    expect(await errorOf(staffTransition(db, student, o.id as string, "taken", "placed"))).toContain("FORBIDDEN");
    await asUser(db, student);
    expect(await errorOf(db.query("update public.orders set status = 'collected' where id = $1", [o.id]))).toMatch(/permission denied/);
    expect(await errorOf(db.query("select public.set_price_tiers('bw', '[]'::jsonb)"))).toContain("FORBIDDEN");
    expect(await errorOf(db.query("select public.shop_stats(7)"))).toContain("FORBIDDEN");
  });

  it("lets students cancel only before printing starts", async () => {
    const o = await cashOrder();
    await asUser(db, student);
    const cancelled = await one(db, "select * from public.cancel_my_order($1)", [o.id]);
    expect(cancelled).toMatchObject({ status: "cancelled", cancel_code: "student" });

    const o2 = await cashOrder();
    await staffTransition(db, staff, o2.id as string, "taken", "placed");
    await asUser(db, student);
    expect(await errorOf(db.query("select * from public.cancel_my_order($1)", [o2.id]))).toContain("CANNOT_CANCEL");

    const other = await createStudent(db);
    await asUser(db, other);
    expect(await errorOf(db.query("select * from public.cancel_my_order($1)", [o2.id]))).toContain("ORDER_NOT_FOUND");
  });

  it("reports queue position to the student", async () => {
    const fresh = await createDb();
    const s1 = await createStudent(fresh);
    const s2 = await createStudent(fresh);
    const f1 = await createFile(fresh, s1, { pages: 1 });
    const f2 = await createFile(fresh, s2, { pages: 1 });
    await placeOrder(fresh, s1, "cash", [{ file_id: f1, color_mode: "bw", copies: 1 }]);
    await asSuperuser(fresh);
    await fresh.exec("update public.orders set queued_at = now() - interval '1 minute'");
    const mine = await placeOrder(fresh, s2, "cash", [{ file_id: f2, color_mode: "bw", copies: 1 }]);
    await asUser(fresh, s2);
    expect((await one(fresh, "select public.queue_position($1) as n", [mine.id])).n).toBe(1);
    await asUser(fresh, s1);
    expect((await one(fresh, "select public.queue_position($1) as n", [mine.id])).n).toBe(0);
  });

  it("produces pilot stats for staff", async () => {
    await asUser(db, staff);
    const stats = (await one<{ s: Record<string, unknown> }>(db, "select public.shop_stats(7) as s")).s;
    expect(stats.by_day).toHaveLength(7);
    expect(stats.by_hour).toHaveLength(24);
    expect((stats.totals as Row).orders).toBeGreaterThan(0);
  });
});

describe("online payments", () => {
  let db: Db;
  let student: string;
  let staff: string;

  beforeAll(async () => {
    db = await createDb();
    await settings(db, "max_active_orders = 50");
    staff = await createStaff(db, "staff@shop.in");
    student = await createStudent(db);
  });

  async function onlineOrder(rzp: string) {
    const file = await createFile(db, student, { pages: 10 });
    const o = await placeOrder(db, student, "online", [{ file_id: file, color_mode: "bw", copies: 1 }]);
    await asService(db);
    await db.query("update public.orders set razorpay_order_id = $1 where id = $2", [rzp, o.id]);
    return o;
  }

  async function markPaid(rzp: string, pay: string, amount: number) {
    await asService(db);
    return one<Row>(db, "select * from public.mark_order_paid($1, $2, $3)", [rzp, pay, amount]);
  }

  it("queues the order once paid, and is idempotent", async () => {
    const o = await onlineOrder("order_1");
    const paid = await markPaid("order_1", "pay_1", o.amount_paise as number);
    expect(paid).toMatchObject({ status: "placed", payment_status: "paid", razorpay_payment_id: "pay_1" });
    expect(paid.queued_at).not.toBeNull();
    const again = await markPaid("order_1", "pay_1", o.amount_paise as number);
    expect(again.queued_at).toEqual(paid.queued_at);
    // A second, different payment leaves the order untouched for the caller to refund.
    const dup = await markPaid("order_1", "pay_2", o.amount_paise as number);
    expect(dup.razorpay_payment_id).toBe("pay_1");
  });

  it("refuses a payment of the wrong amount", async () => {
    const o = await onlineOrder("order_2");
    expect(await errorOf(markPaid("order_2", "pay_3", (o.amount_paise as number) - 100))).toContain("AMOUNT_MISMATCH");
  });

  it("only the server can mark orders paid", async () => {
    await onlineOrder("order_3");
    await asUser(db, student);
    expect(await errorOf(db.query("select public.mark_order_paid('order_3', 'pay_x', 1100)"))).toMatch(/permission denied/);
  });

  it("expires unpaid orders, and revives them if the payment lands late", async () => {
    const o = await onlineOrder("order_4");
    await asSuperuser(db);
    await db.query("update public.orders set created_at = now() - interval '31 minutes' where id = $1", [o.id]);
    await asService(db);
    expect((await one(db, "select public.expire_stale_payments() as n")).n).toBe(1);
    expect((await one(db, "select status, cancel_code from public.orders where id = $1", [o.id]))).toMatchObject({
      status: "cancelled",
      cancel_code: "payment_timeout",
    });

    const revived = await markPaid("order_4", "pay_4", o.amount_paise as number);
    expect(revived).toMatchObject({ status: "placed", payment_status: "paid", cancel_code: null });
  });

  it("gives a revived order a new token if its old one was reissued", async () => {
    const o = await onlineOrder("order_5");
    await asSuperuser(db);
    await db.query("update public.orders set status = 'cancelled', cancel_code = 'payment_timeout' where id = $1", [o.id]);
    // Another open order now holds the same token.
    await db.query(
      `insert into public.orders (token, student_id, status, payment_method, subtotal_paise, amount_paise, total_printed_pages)
       values ($1, $2, 'placed', 'cash', 100, 100, 1)`,
      [o.token, student],
    );
    const revived = await markPaid("order_5", "pay_5", o.amount_paise as number);
    expect(revived.status).toBe("placed");
    expect(revived.token).not.toBe(o.token);
  });

  it("marks a refund when payment arrives after the student cancelled", async () => {
    const o = await onlineOrder("order_6");
    await asUser(db, student);
    await db.query("select public.cancel_my_order($1)", [o.id]);
    const late = await markPaid("order_6", "pay_6", o.amount_paise as number);
    expect(late).toMatchObject({ status: "cancelled", payment_status: "refund_pending" });
  });

  it("marks a refund when the shop cancels a paid order", async () => {
    const o = await onlineOrder("order_7");
    await markPaid("order_7", "pay_7", o.amount_paise as number);
    const c = await staffTransition(db, staff, o.id as string, "cancelled", "placed", { code: "file_problem", reason: "PDF needs a password" });
    expect(c).toMatchObject({ status: "cancelled", payment_status: "refund_pending", cancel_reason: "PDF needs a password" });
  });

  it("paid online orders can be handed over without cash", async () => {
    const o = await onlineOrder("order_8");
    await markPaid("order_8", "pay_8", o.amount_paise as number);
    await staffTransition(db, staff, o.id as string, "taken", "placed");
    await staffTransition(db, staff, o.id as string, "ready", "taken");
    const done = await staffTransition(db, staff, o.id as string, "collected", "ready");
    expect(done.status).toBe("collected");
  });
});

describe("privacy and row level security", () => {
  let db: Db;
  let alice: string;
  let bob: string;
  let staff: string;
  let aliceOrder: string;

  beforeAll(async () => {
    db = await createDb();
    staff = await createStaff(db, "staff@shop.in");
    alice = await createStudent(db);
    bob = await createStudent(db);
    const file = await createFile(db, alice, { pages: 2 });
    aliceOrder = (await placeOrder(db, alice, "cash", [{ file_id: file, color_mode: "bw", copies: 1 }])).id as string;
  });

  it("students see only their own orders, items and files", async () => {
    await asUser(db, bob);
    expect((await db.query("select * from public.orders")).rows).toHaveLength(0);
    expect((await db.query("select * from public.order_items")).rows).toHaveLength(0);
    expect((await db.query("select * from public.files")).rows).toHaveLength(0);
    expect((await db.query("select * from public.profiles")).rows).toHaveLength(1);

    await asUser(db, alice);
    expect((await db.query("select * from public.orders")).rows).toHaveLength(1);
    expect((await db.query("select * from public.order_items")).rows).toHaveLength(1);
  });

  it("staff see every order and student", async () => {
    await asUser(db, staff);
    expect((await db.query("select * from public.orders where id = $1", [aliceOrder])).rows).toHaveLength(1);
    expect((await db.query("select * from public.profiles")).rows.length).toBeGreaterThanOrEqual(3);
  });

  it("anonymous visitors see prices and settings but nothing personal", async () => {
    await asAnon(db);
    expect((await db.query("select * from public.price_tiers")).rows.length).toBeGreaterThan(0);
    expect((await db.query("select shop_name from public.app_settings")).rows).toHaveLength(1);
    expect(await errorOf(db.query("select * from public.orders"))).toMatch(/permission denied/);
    expect(await errorOf(db.query("select * from public.profiles"))).toMatch(/permission denied/);
  });

  it("students can't write files or orders directly", async () => {
    await asUser(db, bob);
    expect(
      await errorOf(
        db.query(
          `insert into public.files (owner_id, object_key, original_name, mime_type, kind, size_bytes, status, page_detection, detected_pages)
           values ($1, 'x', 'x.pdf', 'application/pdf', 'pdf', 1, 'ready', 'exact', 1)`,
          [bob],
        ),
      ),
    ).toMatch(/permission denied/);
    expect(await errorOf(db.query("delete from public.orders"))).toMatch(/permission denied/);
    expect(await errorOf(db.query("select * from public.payment_events"))).toMatch(/permission denied/);
  });

  it("only admins change settings", async () => {
    await asUser(db, staff);
    const res = await db.query("update public.app_settings set max_copies = 3 where id = 1 returning id");
    expect(res.rows).toHaveLength(0);
    // ...but staff may pause orders.
    const s = await one(db, "select * from public.set_accepting_orders(false, 'Back at 2 pm')");
    expect(s).toMatchObject({ accepting_orders: false, closed_message: "Back at 2 pm" });
  });

  it("push subscriptions belong to their owner", async () => {
    await asUser(db, alice);
    await db.query("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push/a', 'k', 'a')", [alice]);
    expect(
      await errorOf(
        db.query("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push/b', 'k', 'a')", [bob]),
      ),
    ).toMatch(/row-level security/);
    await asUser(db, bob);
    expect((await db.query("select * from public.push_subscriptions")).rows).toHaveLength(0);
  });
});

describe("prices", () => {
  it("staff replace tiers atomically, with validation", async () => {
    const db = await createDb();
    const staff = await createStaff(db, "staff@shop.in");
    await asUser(db, staff);
    const bad = (tiers: Row[]) => errorOf(db.query("select * from public.set_price_tiers('bw', $1::jsonb)", [JSON.stringify(tiers)]));
    expect(await bad([])).toContain("INVALID_PRICE_TIERS");
    expect(await bad([{ min_pages: 10, rate_cash_paise: 100, rate_online_paise: 100 }])).toContain("INVALID_PRICE_TIERS");
    expect(
      await bad([
        { min_pages: 1, rate_cash_paise: 100, rate_online_paise: 100 },
        { min_pages: 1, rate_cash_paise: 90, rate_online_paise: 90 },
      ]),
    ).toContain("INVALID_PRICE_TIERS");
    expect(await bad([{ min_pages: 1, rate_cash_paise: 0, rate_online_paise: 100 }])).toContain("INVALID_PRICE_TIERS");

    const rows = (
      await db.query("select * from public.set_price_tiers('bw', $1::jsonb)", [
        JSON.stringify([
          { min_pages: 50, rate_cash_paise: 90, rate_online_paise: 95 },
          { min_pages: 1, rate_cash_paise: 150, rate_online_paise: 155 },
        ]),
      ])
    ).rows as Row[];
    expect(rows.map((r) => r.min_pages)).toEqual([1, 50]);
    // Colour tiers untouched.
    expect((await db.query("select * from public.price_tiers where color_mode = 'color'")).rows).toHaveLength(2);
  });
});

describe("file retention", () => {
  it("lists abandoned uploads and files past retention, but keeps files still needed", async () => {
    const db = await createDb();
    await settings(db, "max_active_orders = 50, max_unpaid_orders = 20, file_retention_days = 7");
    const student = await createStudent(db);

    const abandoned = await createFile(db, student, { pages: 1 });
    const fresh = await createFile(db, student, { pages: 1 });
    const oldDone = await createFile(db, student, { pages: 1 });
    const oldQueued = await createFile(db, student, { pages: 1 });
    const recentDone = await createFile(db, student, { pages: 1 });

    const done = await placeOrder(db, student, "cash", [{ file_id: oldDone, color_mode: "bw", copies: 1 }]);
    const queued = await placeOrder(db, student, "cash", [{ file_id: oldQueued, color_mode: "bw", copies: 1 }]);
    const recent = await placeOrder(db, student, "cash", [{ file_id: recentDone, color_mode: "bw", copies: 1 }]);

    await asSuperuser(db);
    await db.query("update public.files set created_at = now() - interval '2 days' where id = any($1)", [
      [abandoned, oldDone, oldQueued, recentDone],
    ]);
    await db.query("update public.orders set created_at = now() - interval '8 days' where id = any($1)", [[done.id, queued.id]]);
    await db.query("update public.orders set status = 'cancelled', cancel_code = 'shop' where id = any($1)", [[done.id, recent.id]]);

    await asService(db);
    const due = (await db.query<{ id: string }>("select id from public.files_due_for_deletion(100)")).rows.map((r) => r.id);
    expect(due.sort()).toEqual([abandoned, oldDone].sort());
    expect(due).not.toContain(fresh);
    expect(due).not.toContain(oldQueued);
    expect(due).not.toContain(recentDone);

    expect((await one(db, "select public.mark_files_deleted($1) as n", [due])).n).toBe(2);
    expect((await db.query("select id from public.files_due_for_deletion(100)")).rows).toHaveLength(0);

    await asUser(db, student);
    expect(await errorOf(db.query("select * from public.files_due_for_deletion(100)"))).toMatch(/permission denied/);
  });
});
