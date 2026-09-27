import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// Minimal stand-ins for what a Supabase project provides before migrations
// run: the auth schema, auth.uid(), the API roles and the realtime publication.
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    created_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create publication supabase_realtime;
`;

export type Db = PGlite;

export async function createDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const dir = join(__dirname, "..", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
  return db;
}

/** Creates an auth user (firing the signup trigger) and returns its id. */
export async function signUp(db: Db, email: string): Promise<string> {
  await asSuperuser(db);
  const res = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return res.rows[0].id;
}

export async function asUser(db: Db, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

export async function asAnon(db: Db) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role anon");
}

export async function asService(db: Db) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role service_role");
}

export async function asSuperuser(db: Db) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

/** Runs a query expecting it to fail and returns the error message. */
export async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the query to fail");
}

let studentCounter = 0;

/** Signs up a student and completes their profile. */
export async function createStudent(db: Db, overrides: { email?: string; roll?: string } = {}) {
  studentCounter += 1;
  const n = studentCounter;
  const id = await signUp(db, overrides.email ?? `student${n}@college.edu`);
  await asUser(db, id);
  await db.query("select public.save_profile($1, $2, $3, $4, $5)", [
    `Student ${n}`,
    overrides.roll ?? `21EC${String(n).padStart(3, "0")}`,
    "ECE",
    "B",
    `98765${String(43210 + n).slice(-5)}`,
  ]);
  return id;
}

/** Inserts a ready file for a user, as the upload API would after counting pages. */
export async function createFile(
  db: Db,
  ownerId: string,
  opts: { kind?: "pdf" | "docx" | "doc" | "image"; pages?: number | null; detection?: "exact" | "estimate" | "none" } = {},
): Promise<string> {
  const kind = opts.kind ?? "pdf";
  const detection = opts.detection ?? (kind === "doc" ? "none" : kind === "docx" ? "estimate" : "exact");
  const pages = opts.pages === undefined ? (kind === "image" ? 1 : 10) : opts.pages;
  await asService(db);
  const res = await db.query<{ id: string }>(
    `insert into public.files (owner_id, object_key, original_name, mime_type, kind, size_bytes, status, page_detection, detected_pages, uploaded_at)
     values ($1, 'uploads/' || gen_random_uuid(), $2, 'application/pdf', $3, 1000, 'ready', $4, $5, now())
     returning id`,
    [ownerId, `file.${kind}`, kind, detection, pages],
  );
  return res.rows[0].id;
}
