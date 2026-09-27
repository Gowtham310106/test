-- ============================================================================
-- Campus Xerox — initial schema
--
-- Everything that decides money, queue order or who may see what lives here,
-- so the rules hold no matter which client calls the database:
--   * pricing is computed in place_order(), never trusted from the browser
--   * order status only moves through the transition functions below
--   * row level security keeps each student to their own orders and files
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('student', 'staff', 'admin');
create type public.order_status as enum (
  'awaiting_payment', -- online order created, payment not confirmed yet (hidden from the shop)
  'placed',           -- in the shop queue
  'taken',            -- staff started printing
  'ready',            -- printed, waiting for the student
  'collected',        -- handed over against the token
  'cancelled'
);
create type public.payment_method as enum ('online', 'cash');
create type public.payment_status as enum ('unpaid', 'paid', 'refund_pending', 'refunded');
create type public.color_mode as enum ('bw', 'color');
create type public.range_type as enum ('all', 'from', 'to', 'range');
create type public.file_kind as enum ('pdf', 'docx', 'doc', 'image');
create type public.file_status as enum ('pending', 'ready', 'rejected', 'deleted');
-- exact: counted from the file; estimate: read from document metadata;
-- none: could not be counted, the student has to enter it
create type public.page_detection as enum ('pending', 'exact', 'estimate', 'none');
create type public.cancel_code as enum ('student', 'shop', 'payment_timeout', 'not_collected', 'file_problem');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  shop_name text not null default 'Campus Xerox' check (char_length(shop_name) between 2 and 60),
  accepting_orders boolean not null default true,
  closed_message text not null default 'The shop is not taking orders right now. Please check back later.'
    check (char_length(closed_message) <= 200),
  -- Empty list = any email may sign up. Set this before going live.
  allowed_email_domains text[] not null default '{}',
  departments text[] not null default '{ECE,CSE,EEE,MECH,CIVIL,IT,AIDS,MBA}',
  timezone text not null default 'Asia/Kolkata',
  max_file_mb int not null default 25 check (max_file_mb between 1 and 100),
  max_files_per_order int not null default 10 check (max_files_per_order between 1 and 30),
  max_pages_per_order int not null default 2000 check (max_pages_per_order between 10 and 20000),
  max_copies int not null default 50 check (max_copies between 1 and 500),
  max_active_orders int not null default 5 check (max_active_orders between 1 and 50),
  -- 0 turns "pay at collection" off entirely
  max_unpaid_orders int not null default 2 check (max_unpaid_orders between 0 and 20),
  -- Students with this many uncollected orders lose "pay at collection". 0 = never.
  cash_block_after_no_shows int not null default 3 check (cash_block_after_no_shows between 0 and 50),
  file_retention_days int not null default 7 check (file_retention_days between 1 and 90),
  payment_window_minutes int not null default 30 check (payment_window_minutes between 5 and 1440),
  round_to_rupee boolean not null default true,
  online_payments_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values (1);

create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.staff_allowlist (
  email text primary key check (email = lower(btrim(email)) and email like '%_@_%'),
  role public.user_role not null default 'staff' check (role in ('staff', 'admin')),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role public.user_role not null default 'student',
  full_name text check (char_length(full_name) between 2 and 80),
  roll_number text unique check (roll_number ~ '^[A-Z0-9/-]{3,20}$'),
  department text check (char_length(department) between 2 and 40),
  section text check (char_length(section) between 1 and 10),
  phone text check (phone ~ '^[6-9][0-9]{9}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('staff', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- True when the email may sign up: staff allowlist, an allowed college domain
-- (subdomains included), or no domain restriction configured.
create or replace function public.email_domain_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select lower(btrim(coalesce(p_email, ''))) as email,
           lower(substring(btrim(coalesce(p_email, '')) from '@([^@]+)$')) as domain
  )
  select
    e.domain is not null
    and (
      exists (select 1 from public.staff_allowlist a where a.email = e.email)
      or coalesce(cardinality(s.allowed_email_domains), 0) = 0
      or exists (
        select 1
        from unnest(s.allowed_email_domains) as d(domain)
        where e.domain = lower(btrim(d.domain, ' @'))
           or e.domain like '%.' || lower(btrim(d.domain, ' @'))
      )
    )
  from e
  cross join public.app_settings s
  where s.id = 1;
$$;

-- Runs when Supabase Auth creates a user: blocks outsiders and creates the profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  if new.email is null or not public.email_domain_allowed(new.email) then
    raise exception using
      errcode = 'P0001',
      message = 'EMAIL_NOT_ALLOWED',
      hint = 'Only college email addresses can use this service.';
  end if;

  select role into v_role from public.staff_allowlist where email = lower(btrim(new.email));

  insert into public.profiles (id, email, role)
  values (new.id, lower(btrim(new.email)), coalesce(v_role, 'student'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profile roles in step with the staff allowlist.
create or replace function public.sync_staff_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.profiles set role = 'student' where email = old.email;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.email <> new.email then
    update public.profiles set role = 'student' where email = old.email;
  end if;
  update public.profiles set role = new.role where email = new.email;
  return new;
end;
$$;

create trigger staff_allowlist_sync
  after insert or update or delete on public.staff_allowlist
  for each row execute function public.sync_staff_role();

-- Profile edits go through this function: it validates, normalises, and
-- stops a roll number from being changed once set.
create or replace function public.save_profile(
  p_full_name text,
  p_roll_number text default null,
  p_department text default null,
  p_section text default null,
  p_phone text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_name text := nullif(regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), '');
  v_roll text := nullif(upper(regexp_replace(coalesce(p_roll_number, ''), '\s', '', 'g')), '');
  v_dept text := nullif(upper(btrim(coalesce(p_department, ''))), '');
  v_section text := nullif(upper(btrim(coalesce(p_section, ''))), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '');
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'NOT_AUTHENTICATED';
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  -- Accept +91 / 0 prefixes that people type out of habit.
  if v_phone ~ '^\+91[0-9]{10}$' then
    v_phone := substring(v_phone from 4);
  elsif v_phone ~ '^0[0-9]{10}$' then
    v_phone := substring(v_phone from 2);
  end if;

  if v_name is null or char_length(v_name) not between 2 and 80 then
    raise exception using errcode = 'P0001', message = 'INVALID_NAME';
  end if;
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_PHONE';
  end if;
  if v_roll is not null and v_roll !~ '^[A-Z0-9/-]{3,20}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_ROLL_NUMBER';
  end if;
  if v_dept is not null and char_length(v_dept) not between 2 and 40 then
    raise exception using errcode = 'P0001', message = 'INVALID_DEPARTMENT';
  end if;
  if v_section is not null and char_length(v_section) not between 1 and 10 then
    raise exception using errcode = 'P0001', message = 'INVALID_SECTION';
  end if;

  if v_profile.role = 'student'
     and (v_roll is null or v_dept is null or v_section is null or v_phone is null) then
    raise exception using errcode = 'P0001', message = 'PROFILE_INCOMPLETE';
  end if;

  if v_profile.roll_number is not null and v_roll is distinct from v_profile.roll_number then
    raise exception using errcode = 'P0001', message = 'ROLL_NUMBER_LOCKED';
  end if;

  begin
    update public.profiles
       set full_name = v_name,
           roll_number = v_roll,
           department = v_dept,
           section = v_section,
           phone = v_phone
     where id = v_uid
     returning * into v_profile;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'ROLL_NUMBER_TAKEN';
  end;

  return v_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pricing
-- ---------------------------------------------------------------------------
-- A tier applies when the order's printed pages of that colour mode reach
-- min_pages. Online rates can differ to absorb the payment gateway fee.
create table public.price_tiers (
  id bigint generated always as identity primary key,
  color_mode public.color_mode not null,
  min_pages int not null check (min_pages >= 1),
  rate_cash_paise int not null check (rate_cash_paise between 1 and 100000),
  rate_online_paise int not null check (rate_online_paise between 1 and 100000),
  unique (color_mode, min_pages)
);

insert into public.price_tiers (color_mode, min_pages, rate_cash_paise, rate_online_paise) values
  ('bw', 1, 100, 105),
  ('bw', 100, 80, 85),
  ('color', 1, 1000, 1030),
  ('color', 20, 800, 825);

-- Replaces every tier of one colour mode in a single step.
create or replace function public.set_price_tiers(p_color_mode public.color_mode, p_tiers jsonb)
returns setof public.price_tiers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier jsonb;
  v_min int;
  v_cash int;
  v_online int;
  v_seen int[] := '{}';
begin
  if not public.is_staff() then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  if jsonb_typeof(p_tiers) is distinct from 'array' or jsonb_array_length(p_tiers) = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_PRICE_TIERS', detail = 'At least one tier is required.';
  end if;
  if jsonb_array_length(p_tiers) > 10 then
    raise exception using errcode = 'P0001', message = 'INVALID_PRICE_TIERS', detail = 'At most 10 tiers.';
  end if;

  for v_tier in select * from jsonb_array_elements(p_tiers) loop
    v_min := (v_tier ->> 'min_pages')::int;
    v_cash := (v_tier ->> 'rate_cash_paise')::int;
    v_online := (v_tier ->> 'rate_online_paise')::int;
    if v_min is null or v_min < 1 or v_min > 100000
       or v_cash is null or v_cash not between 1 and 100000
       or v_online is null or v_online not between 1 and 100000 then
      raise exception using errcode = 'P0001', message = 'INVALID_PRICE_TIERS', detail = 'Rates must be between ₹0.01 and ₹1000 per page.';
    end if;
    if v_min = any (v_seen) then
      raise exception using errcode = 'P0001', message = 'INVALID_PRICE_TIERS', detail = 'Two tiers start at the same page count.';
    end if;
    v_seen := v_seen || v_min;
  end loop;

  if not (1 = any (v_seen)) then
    raise exception using errcode = 'P0001', message = 'INVALID_PRICE_TIERS', detail = 'One tier must start at 1 page.';
  end if;

  delete from public.price_tiers where color_mode = p_color_mode;
  insert into public.price_tiers (color_mode, min_pages, rate_cash_paise, rate_online_paise)
  select p_color_mode, (t ->> 'min_pages')::int, (t ->> 'rate_cash_paise')::int, (t ->> 'rate_online_paise')::int
  from jsonb_array_elements(p_tiers) as t;

  return query select * from public.price_tiers where color_mode = p_color_mode order by min_pages;
end;
$$;

-- ---------------------------------------------------------------------------
-- Files (objects live in Cloudflare R2; this is the index)
-- ---------------------------------------------------------------------------
create table public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  object_key text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 200),
  mime_type text not null,
  kind public.file_kind not null,
  size_bytes bigint not null check (size_bytes > 0),
  status public.file_status not null default 'pending',
  page_detection public.page_detection not null default 'pending',
  detected_pages int check (detected_pages > 0),
  is_encrypted boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  deleted_at timestamptz
);

create index files_owner_created_idx on public.files (owner_id, created_at desc);
create index files_status_created_idx on public.files (status, created_at);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
-- Short numbers students show at the counter. They cycle through 1000-9999 and
-- are unique among orders that are still open.
create sequence public.order_token_seq as int minvalue 1000 maxvalue 9999 start 1000 cycle;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  token int not null check (token between 1000 and 9999),
  student_id uuid not null references public.profiles (id) on delete cascade,
  status public.order_status not null,
  payment_method public.payment_method not null,
  payment_status public.payment_status not null default 'unpaid',
  subtotal_paise int not null check (subtotal_paise > 0),
  amount_paise int not null check (amount_paise >= subtotal_paise and amount_paise - subtotal_paise < 100),
  total_printed_pages int not null check (total_printed_pages > 0),
  alt_contact_name text check (char_length(alt_contact_name) between 2 and 80),
  alt_contact_phone text check (alt_contact_phone ~ '^[6-9][0-9]{9}$'),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  taken_at timestamptz,
  taken_by uuid references public.profiles (id) on delete set null,
  ready_at timestamptz,
  collected_at timestamptz,
  collected_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancel_code public.cancel_code,
  cancel_reason text check (char_length(cancel_reason) <= 200),
  paid_at timestamptz,
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  refund_id text,
  refund_error text,
  rating smallint check (rating between 1 and 5),
  feedback text check (char_length(feedback) <= 500),
  updated_at timestamptz not null default now(),
  check ((status = 'cancelled') = (cancel_code is not null))
);

create unique index orders_open_token_uidx on public.orders (token)
  where status in ('awaiting_payment', 'placed', 'taken', 'ready');
create index orders_student_created_idx on public.orders (student_id, created_at desc);
create index orders_status_queued_idx on public.orders (status, queued_at);
create index orders_created_idx on public.orders (created_at);

create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  position smallint not null check (position >= 1),
  file_id uuid not null references public.files (id),
  file_name text not null,
  file_kind public.file_kind not null,
  color_mode public.color_mode not null,
  range_type public.range_type not null,
  page_from int not null,
  page_to int not null,
  file_pages int not null check (file_pages > 0),
  pages_source text not null check (pages_source in ('exact', 'estimate', 'manual')),
  copies int not null check (copies between 1 and 500),
  printed_pages int not null,
  rate_paise int not null check (rate_paise > 0),
  amount_paise int not null,
  downloaded_at timestamptz,
  unique (order_id, position),
  check (page_from >= 1 and page_from <= page_to and page_to <= file_pages),
  check (printed_pages = (page_to - page_from + 1) * copies),
  check (amount_paise = printed_pages * rate_paise)
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_file_idx on public.order_items (file_id);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_id uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, created_at);

create or replace function public.log_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_events (order_id, from_status, to_status, actor_id, note)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid()),
      case when new.status = 'cancelled' then coalesce(new.cancel_reason, new.cancel_code::text) end
    );
  end if;
  return new;
end;
$$;

create trigger orders_log_status
  after insert or update of status on public.orders
  for each row execute function public.log_order_status();

-- Orders a student left uncollected (shown to staff, limits pay-at-collection).
create or replace function public.no_show_count(p_profile public.profiles)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.orders
  where student_id = p_profile.id and cancel_code = 'not_collected';
$$;

create or replace function public.next_order_token()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token int;
  v_attempts int := 0;
begin
  loop
    v_token := nextval('public.order_token_seq');
    exit when not exists (
      select 1 from public.orders
      where token = v_token and status in ('awaiting_payment', 'placed', 'taken', 'ready')
    );
    v_attempts := v_attempts + 1;
    if v_attempts >= 9000 then
      raise exception using errcode = 'P0001', message = 'NO_TOKENS_AVAILABLE';
    end if;
  end loop;
  return v_token;
end;
$$;

-- Online orders whose payment never arrived are cancelled after the window.
-- A payment that lands later revives the order (see mark_order_paid).
create or replace function public.expire_stale_payments(p_student_id uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform set_config('app.actor_id', '', true);
  update public.orders o
     set status = 'cancelled',
         cancel_code = 'payment_timeout',
         cancel_reason = 'Payment was not completed in time.',
         cancelled_at = now()
    from public.app_settings s
   where s.id = 1
     and o.status = 'awaiting_payment'
     and o.created_at < now() - make_interval(mins => s.payment_window_minutes)
     and (p_student_id is null or o.student_id = p_student_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Creates an order for the signed-in student. Prices are worked out here from
-- the current tiers; p_expected_amount_paise lets the app catch a price change
-- between the preview and the submit.
--
-- p_items: [{ file_id, color_mode, range_type, page_from, page_to, copies, manual_pages }]
create or replace function public.place_order(
  p_payment_method public.payment_method,
  p_items jsonb,
  p_expected_amount_paise int default null,
  p_alt_contact_name text default null,
  p_alt_contact_phone text default null,
  p_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_settings public.app_settings;
  v_order public.orders;
  v_item jsonb;
  v_file public.files;
  v_resolved jsonb := '[]'::jsonb;
  v_count int;
  v_position int := 0;
  v_color public.color_mode;
  v_range public.range_type;
  v_copies int;
  v_manual int;
  v_file_pages int;
  v_source text;
  v_from int;
  v_to int;
  v_printed bigint;
  v_bw_pages bigint := 0;
  v_color_pages bigint := 0;
  v_bw_rate int;
  v_color_rate int;
  v_rate int;
  v_subtotal bigint := 0;
  v_amount bigint;
  v_alt_name text := nullif(regexp_replace(btrim(coalesce(p_alt_contact_name, '')), '\s+', ' ', 'g'), '');
  v_alt_phone text := nullif(regexp_replace(coalesce(p_alt_contact_phone, ''), '[\s-]', '', 'g'), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'NOT_AUTHENTICATED';
  end if;

  -- Locking the profile row serialises concurrent submits from one student,
  -- so the per-student limits below cannot be raced.
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found or v_profile.full_name is null or v_profile.roll_number is null
     or v_profile.department is null or v_profile.section is null or v_profile.phone is null then
    raise exception using errcode = 'P0001', message = 'PROFILE_INCOMPLETE';
  end if;

  select * into v_settings from public.app_settings where id = 1;
  if not v_settings.accepting_orders then
    raise exception using errcode = 'P0001', message = 'SHOP_CLOSED', detail = v_settings.closed_message;
  end if;
  if p_payment_method = 'online' and not v_settings.online_payments_enabled then
    raise exception using errcode = 'P0001', message = 'ONLINE_PAYMENT_DISABLED';
  end if;

  perform public.expire_stale_payments(v_uid);

  select count(*) into v_count from public.orders
   where student_id = v_uid and status in ('awaiting_payment', 'placed', 'taken', 'ready');
  if v_count >= v_settings.max_active_orders then
    raise exception using errcode = 'P0001', message = 'TOO_MANY_ACTIVE_ORDERS', detail = v_settings.max_active_orders::text;
  end if;

  if p_payment_method = 'cash' then
    if v_settings.max_unpaid_orders = 0 then
      raise exception using errcode = 'P0001', message = 'CASH_DISABLED';
    end if;
    if v_settings.cash_block_after_no_shows > 0
       and public.no_show_count(v_profile) >= v_settings.cash_block_after_no_shows then
      raise exception using errcode = 'P0001', message = 'CASH_BLOCKED';
    end if;
    select count(*) into v_count from public.orders
     where student_id = v_uid and payment_method = 'cash' and payment_status = 'unpaid'
       and status in ('placed', 'taken', 'ready');
    if v_count >= v_settings.max_unpaid_orders then
      raise exception using errcode = 'P0001', message = 'TOO_MANY_UNPAID_ORDERS', detail = v_settings.max_unpaid_orders::text;
    end if;
  end if;

  -- Normalise the optional contact details.
  if v_alt_phone ~ '^\+91[0-9]{10}$' then
    v_alt_phone := substring(v_alt_phone from 4);
  elsif v_alt_phone ~ '^0[0-9]{10}$' then
    v_alt_phone := substring(v_alt_phone from 2);
  end if;
  if (v_alt_phone is not null and v_alt_phone !~ '^[6-9][0-9]{9}$')
     or (v_alt_name is not null and char_length(v_alt_name) not between 2 and 80) then
    raise exception using errcode = 'P0001', message = 'INVALID_ALT_CONTACT';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception using errcode = 'P0001', message = 'NOTE_TOO_LONG';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'NO_ITEMS';
  end if;
  if jsonb_array_length(p_items) > v_settings.max_files_per_order then
    raise exception using errcode = 'P0001', message = 'TOO_MANY_FILES', detail = v_settings.max_files_per_order::text;
  end if;

  -- Pass 1: validate every item and work out its pages.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_position := v_position + 1;

    select * into v_file from public.files
     where id = (v_item ->> 'file_id')::uuid and owner_id = v_uid;
    if not found or v_file.status <> 'ready' then
      raise exception using errcode = 'P0001', message = 'FILE_NOT_READY', detail = v_position::text;
    end if;

    v_color := coalesce((v_item ->> 'color_mode')::public.color_mode, 'bw');
    v_range := coalesce((v_item ->> 'range_type')::public.range_type, 'all');
    v_copies := coalesce((v_item ->> 'copies')::int, 1);
    v_manual := (v_item ->> 'manual_pages')::int;

    if v_copies < 1 or v_copies > v_settings.max_copies then
      raise exception using errcode = 'P0001', message = 'INVALID_COPIES', detail = v_settings.max_copies::text;
    end if;

    if v_file.kind = 'image' then
      v_file_pages := 1;
      v_source := 'exact';
      v_range := 'all';
    elsif v_file.page_detection = 'exact' then
      v_file_pages := v_file.detected_pages;
      v_source := 'exact';
    elsif v_manual is not null then
      if v_manual < 1 or v_manual > 2000 then
        raise exception using errcode = 'P0001', message = 'INVALID_PAGE_COUNT', detail = v_position::text;
      end if;
      v_file_pages := v_manual;
      v_source := case when v_manual = v_file.detected_pages then 'estimate' else 'manual' end;
    elsif v_file.detected_pages is not null then
      v_file_pages := v_file.detected_pages;
      v_source := 'estimate';
    else
      raise exception using errcode = 'P0001', message = 'PAGES_REQUIRED', detail = v_position::text;
    end if;

    case v_range
      when 'all' then
        v_from := 1;
        v_to := v_file_pages;
      when 'from' then
        v_from := (v_item ->> 'page_from')::int;
        v_to := v_file_pages;
      when 'to' then
        v_from := 1;
        v_to := (v_item ->> 'page_to')::int;
      when 'range' then
        v_from := (v_item ->> 'page_from')::int;
        v_to := (v_item ->> 'page_to')::int;
    end case;

    if v_from is null or v_to is null or v_from < 1 or v_to > v_file_pages or v_from > v_to then
      raise exception using errcode = 'P0001', message = 'INVALID_PAGE_RANGE', detail = v_position::text;
    end if;

    v_printed := (v_to - v_from + 1)::bigint * v_copies;
    if v_color = 'bw' then
      v_bw_pages := v_bw_pages + v_printed;
    else
      v_color_pages := v_color_pages + v_printed;
    end if;

    v_resolved := v_resolved || jsonb_build_object(
      'position', v_position,
      'file_id', v_file.id,
      'file_name', v_file.original_name,
      'file_kind', v_file.kind,
      'color_mode', v_color,
      'range_type', v_range,
      'page_from', v_from,
      'page_to', v_to,
      'file_pages', v_file_pages,
      'pages_source', v_source,
      'copies', v_copies,
      'printed_pages', v_printed
    );
  end loop;

  if v_bw_pages + v_color_pages > v_settings.max_pages_per_order then
    raise exception using errcode = 'P0001', message = 'ORDER_TOO_LARGE', detail = v_settings.max_pages_per_order::text;
  end if;

  -- Pass 2: pick the tier for each colour mode from the order's page totals.
  if v_bw_pages > 0 then
    select case when p_payment_method = 'online' then rate_online_paise else rate_cash_paise end
      into v_bw_rate
      from public.price_tiers
     where color_mode = 'bw' and min_pages <= v_bw_pages
     order by min_pages desc
     limit 1;
    if v_bw_rate is null then
      raise exception using errcode = 'P0001', message = 'PRICING_NOT_CONFIGURED';
    end if;
  end if;
  if v_color_pages > 0 then
    select case when p_payment_method = 'online' then rate_online_paise else rate_cash_paise end
      into v_color_rate
      from public.price_tiers
     where color_mode = 'color' and min_pages <= v_color_pages
     order by min_pages desc
     limit 1;
    if v_color_rate is null then
      raise exception using errcode = 'P0001', message = 'PRICING_NOT_CONFIGURED';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(v_resolved) loop
    v_rate := case when v_item ->> 'color_mode' = 'bw' then v_bw_rate else v_color_rate end;
    v_subtotal := v_subtotal + (v_item ->> 'printed_pages')::bigint * v_rate;
  end loop;

  v_amount := case when v_settings.round_to_rupee then ((v_subtotal + 99) / 100) * 100 else v_subtotal end;

  if v_amount > 10000000 then
    raise exception using errcode = 'P0001', message = 'ORDER_TOO_LARGE', detail = v_settings.max_pages_per_order::text;
  end if;

  if p_expected_amount_paise is not null and p_expected_amount_paise <> v_amount then
    raise exception using errcode = 'P0001', message = 'PRICE_CHANGED', detail = v_amount::text;
  end if;

  insert into public.orders (
    token, student_id, status, payment_method, payment_status,
    subtotal_paise, amount_paise, total_printed_pages,
    alt_contact_name, alt_contact_phone, note, queued_at
  ) values (
    public.next_order_token(),
    v_uid,
    case when p_payment_method = 'online' then 'awaiting_payment'::public.order_status else 'placed'::public.order_status end,
    p_payment_method,
    'unpaid',
    v_subtotal,
    v_amount,
    v_bw_pages + v_color_pages,
    v_alt_name,
    v_alt_phone,
    v_note,
    case when p_payment_method = 'cash' then now() end
  )
  returning * into v_order;

  insert into public.order_items (
    order_id, position, file_id, file_name, file_kind, color_mode, range_type,
    page_from, page_to, file_pages, pages_source, copies, printed_pages, rate_paise, amount_paise
  )
  select
    v_order.id,
    (r ->> 'position')::smallint,
    (r ->> 'file_id')::uuid,
    r ->> 'file_name',
    (r ->> 'file_kind')::public.file_kind,
    (r ->> 'color_mode')::public.color_mode,
    (r ->> 'range_type')::public.range_type,
    (r ->> 'page_from')::int,
    (r ->> 'page_to')::int,
    (r ->> 'file_pages')::int,
    r ->> 'pages_source',
    (r ->> 'copies')::int,
    (r ->> 'printed_pages')::int,
    case when r ->> 'color_mode' = 'bw' then v_bw_rate else v_color_rate end,
    (r ->> 'printed_pages')::int * case when r ->> 'color_mode' = 'bw' then v_bw_rate else v_color_rate end
  from jsonb_array_elements(v_resolved) as r;

  return v_order;
end;
$$;

-- Students may cancel until the shop starts printing.
create or replace function public.cancel_my_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders where id = p_order_id and student_id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;
  if v_order.status not in ('awaiting_payment', 'placed') then
    raise exception using errcode = 'P0001', message = 'CANNOT_CANCEL', detail = v_order.status::text;
  end if;

  update public.orders
     set status = 'cancelled',
         cancel_code = 'student',
         cancel_reason = 'Cancelled by the student.',
         cancelled_at = now(),
         cancelled_by = v_uid,
         payment_status = case when payment_status = 'paid' then 'refund_pending'::public.payment_status else payment_status end
   where id = p_order_id
   returning * into v_order;
  return v_order;
end;
$$;

-- Every staff action on an order. p_expected_from guards against two staff
-- members acting on the same order at once: the second one gets STATUS_CHANGED.
create or replace function public.staff_transition_order(
  p_order_id uuid,
  p_to public.order_status,
  p_expected_from public.order_status default null,
  p_cash_received boolean default false,
  p_cancel_code public.cancel_code default null,
  p_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders;
  v_from public.order_status;
  v_code public.cancel_code;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_staff() then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;
  v_from := v_order.status;

  if p_expected_from is not null and v_from <> p_expected_from then
    raise exception using errcode = 'P0001', message = 'STATUS_CHANGED', detail = v_from::text;
  end if;

  if not (
    (v_from = 'placed' and p_to in ('taken', 'cancelled'))
    or (v_from = 'taken' and p_to in ('placed', 'ready', 'cancelled'))
    or (v_from = 'ready' and p_to in ('taken', 'collected', 'cancelled'))
    or (v_from = 'collected' and p_to = 'ready')
    or (v_from = 'awaiting_payment' and p_to = 'cancelled')
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION', detail = v_from::text || '->' || p_to::text;
  end if;

  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception using errcode = 'P0001', message = 'REASON_TOO_LONG';
  end if;

  case p_to
    when 'taken' then
      update public.orders
         set status = 'taken', taken_at = now(), taken_by = v_uid, ready_at = null
       where id = p_order_id returning * into v_order;

    when 'placed' then
      update public.orders
         set status = 'placed', taken_at = null, taken_by = null
       where id = p_order_id returning * into v_order;

    when 'ready' then
      if v_from = 'collected' then
        -- Undo a mistaken hand-over, only shortly after it happened.
        if v_order.collected_at < now() - interval '15 minutes' then
          raise exception using errcode = 'P0001', message = 'UNDO_WINDOW_PASSED';
        end if;
        update public.orders
           set status = 'ready',
               collected_at = null,
               collected_by = null,
               payment_status = case when payment_method = 'cash' then 'unpaid'::public.payment_status else payment_status end,
               paid_at = case when payment_method = 'cash' then null else paid_at end
         where id = p_order_id returning * into v_order;
      else
        update public.orders
           set status = 'ready', ready_at = now()
         where id = p_order_id returning * into v_order;
      end if;

    when 'collected' then
      if v_order.payment_status <> 'paid' then
        if v_order.payment_method = 'cash' and v_order.payment_status = 'unpaid' and p_cash_received then
          v_order.payment_status := 'paid';
        else
          raise exception using errcode = 'P0001', message = 'PAYMENT_PENDING';
        end if;
      end if;
      update public.orders
         set status = 'collected',
             collected_at = now(),
             collected_by = v_uid,
             payment_status = v_order.payment_status,
             paid_at = coalesce(paid_at, now())
       where id = p_order_id returning * into v_order;

    when 'cancelled' then
      v_code := coalesce(p_cancel_code, 'shop');
      if v_code in ('student', 'payment_timeout') then
        raise exception using errcode = 'P0001', message = 'INVALID_CANCEL_CODE';
      end if;
      if v_code = 'not_collected' and v_from <> 'ready' then
        raise exception using errcode = 'P0001', message = 'INVALID_CANCEL_CODE';
      end if;
      update public.orders
         set status = 'cancelled',
             cancel_code = v_code,
             cancel_reason = v_reason,
             cancelled_at = now(),
             cancelled_by = v_uid,
             payment_status = case when payment_status = 'paid' then 'refund_pending'::public.payment_status else payment_status end
       where id = p_order_id returning * into v_order;

    else
      raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
  end case;

  return v_order;
end;
$$;

-- Records a confirmed online payment (called by the server after checking the
-- gateway signature). Safe to call more than once for the same payment.
create or replace function public.mark_order_paid(
  p_razorpay_order_id text,
  p_razorpay_payment_id text,
  p_amount_paise int
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where razorpay_order_id = p_razorpay_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  -- Already recorded (webhook and browser callback both arrive), or a second
  -- payment against an already-paid order: return as is; the caller compares
  -- razorpay_payment_id and refunds a duplicate.
  if v_order.razorpay_payment_id is not null then
    return v_order;
  end if;

  if p_amount_paise is distinct from v_order.amount_paise then
    raise exception using errcode = 'P0001', message = 'AMOUNT_MISMATCH',
      detail = coalesce(p_amount_paise::text, 'null') || ' <> ' || v_order.amount_paise::text;
  end if;

  perform set_config('app.actor_id', '', true);

  if v_order.status = 'awaiting_payment'
     or (v_order.status = 'cancelled' and v_order.cancel_code = 'payment_timeout') then
    -- Late payments bring a timed-out order back; it needs a fresh token if
    -- its old one has been handed to someone else meanwhile.
    update public.orders
       set status = 'placed',
           payment_status = 'paid',
           razorpay_payment_id = p_razorpay_payment_id,
           paid_at = now(),
           queued_at = now(),
           cancel_code = null,
           cancel_reason = null,
           cancelled_at = null,
           cancelled_by = null,
           token = case
             when exists (
               select 1 from public.orders o2
               where o2.token = v_order.token and o2.id <> v_order.id
                 and o2.status in ('awaiting_payment', 'placed', 'taken', 'ready')
             ) then public.next_order_token()
             else token
           end
     where id = v_order.id
     returning * into v_order;
  elsif v_order.status = 'cancelled' then
    -- Paid after the student cancelled: keep it cancelled and refund.
    update public.orders
       set payment_status = 'refund_pending',
           razorpay_payment_id = p_razorpay_payment_id,
           paid_at = now()
     where id = v_order.id
     returning * into v_order;
  else
    update public.orders
       set payment_status = 'paid',
           razorpay_payment_id = p_razorpay_payment_id,
           paid_at = now()
     where id = v_order.id
     returning * into v_order;
  end if;

  return v_order;
end;
$$;

create or replace function public.rate_order(p_order_id uuid, p_rating int, p_feedback text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_feedback text := nullif(btrim(coalesce(p_feedback, '')), '');
begin
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception using errcode = 'P0001', message = 'INVALID_RATING';
  end if;
  if v_feedback is not null and char_length(v_feedback) > 500 then
    raise exception using errcode = 'P0001', message = 'FEEDBACK_TOO_LONG';
  end if;
  update public.orders
     set rating = p_rating, feedback = v_feedback
   where id = p_order_id and student_id = auth.uid() and status = 'collected'
   returning * into v_order;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;
  return v_order;
end;
$$;

-- How many queued orders are ahead of one of the student's own orders.
create or replace function public.queue_position(p_order_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.orders mine
  join public.orders ahead
    on ahead.status in ('placed', 'taken')
   and ahead.queued_at < mine.queued_at
  where mine.id = p_order_id
    and mine.student_id = auth.uid()
    and mine.status = 'placed';
$$;

create or replace function public.set_accepting_orders(p_accepting boolean, p_message text default null)
returns public.app_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.app_settings;
begin
  if not public.is_staff() then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  update public.app_settings
     set accepting_orders = coalesce(p_accepting, accepting_orders),
         closed_message = coalesce(nullif(btrim(coalesce(p_message, '')), ''), closed_message)
   where id = 1
   returning * into v_settings;
  return v_settings;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments & notifications
-- ---------------------------------------------------------------------------
-- Gateway webhook deliveries, kept for idempotency and auditing.
create table public.payment_events (
  id text primary key,
  event_type text not null,
  razorpay_order_id text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------
-- Files whose objects should be removed from R2:
--   * uploads never attached to an order, after 24 hours
--   * files on orders older than the retention period, once no open order
--     still needs them for printing
create or replace function public.files_due_for_deletion(p_limit int default 500)
returns table (id uuid, object_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.object_key
  from public.files f
  cross join public.app_settings s
  where s.id = 1
    and f.status <> 'deleted'
    and (
      (
        not exists (select 1 from public.order_items oi where oi.file_id = f.id)
        and f.created_at < now() - interval '24 hours'
      )
      or (
        exists (select 1 from public.order_items oi where oi.file_id = f.id)
        and not exists (
          select 1
          from public.order_items oi
          join public.orders o on o.id = oi.order_id
          where oi.file_id = f.id
            and (
              o.status in ('awaiting_payment', 'placed', 'taken')
              or o.created_at > now() - make_interval(days => s.file_retention_days)
            )
        )
      )
    )
  order by f.created_at
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

create or replace function public.mark_files_deleted(p_ids uuid[])
returns int
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.files
       set status = 'deleted', deleted_at = now()
     where id = any (p_ids) and status <> 'deleted'
    returning 1
  )
  select count(*)::int from updated;
$$;

-- Pilot measurements for the stats page: order volume, how the work spreads
-- over the day, and how long students wait.
create or replace function public.shop_stats(p_days int default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_days int := greatest(1, least(coalesce(p_days, 14), 120));
  v_since timestamptz;
  v_result jsonb;
begin
  if not public.is_staff() then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  select timezone into v_tz from public.app_settings where id = 1;
  v_since := (date_trunc('day', now() at time zone v_tz) - make_interval(days => v_days - 1)) at time zone v_tz;

  with o as (
    select *
    from public.orders
    where created_at >= v_since and status <> 'awaiting_payment'
      and not (status = 'cancelled' and cancel_code = 'payment_timeout')
  )
  select jsonb_build_object(
    'days', v_days,
    'timezone', v_tz,
    'totals', (
      select jsonb_build_object(
        'orders', count(*),
        'collected', count(*) filter (where status = 'collected'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'not_collected', count(*) filter (where cancel_code = 'not_collected'),
        'pages', coalesce(sum(total_printed_pages) filter (where status <> 'cancelled'), 0),
        'revenue_paise', coalesce(sum(amount_paise) filter (where payment_status = 'paid'), 0),
        'online_orders', count(*) filter (where payment_method = 'online'),
        'cash_orders', count(*) filter (where payment_method = 'cash'),
        'avg_minutes_to_ready', round(avg(extract(epoch from (ready_at - queued_at)) / 60)
          filter (where ready_at is not null and queued_at is not null))::int,
        'avg_rating', round(avg(rating), 2),
        'ratings', count(rating)
      )
      from o
    ),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day::date, 'orders', coalesce(x.orders, 0), 'pages', coalesce(x.pages, 0)) order by d.day)
      from generate_series(
        (now() at time zone v_tz)::date - (v_days - 1),
        (now() at time zone v_tz)::date,
        interval '1 day'
      ) as d(day)
      left join (
        select (created_at at time zone v_tz)::date as day,
               count(*) as orders,
               sum(total_printed_pages) filter (where status <> 'cancelled') as pages
        from o group by 1
      ) x on x.day = d.day::date
    ), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'orders', coalesce(x.orders, 0)) order by h.hour)
      from generate_series(0, 23) as h(hour)
      left join (
        select extract(hour from created_at at time zone v_tz)::int as hour, count(*) as orders
        from o group by 1
      ) x on x.hour = h.hour
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.staff_allowlist enable row level security;
alter table public.profiles enable row level security;
alter table public.price_tiers enable row level security;
alter table public.files enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.payment_events enable row level security;
alter table public.push_subscriptions enable row level security;

-- Settings and prices are public so the sign-in page and price preview work.
create policy "settings are readable" on public.app_settings
  for select to anon, authenticated using (true);
create policy "admins update settings" on public.app_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "prices are readable" on public.price_tiers
  for select to anon, authenticated using (true);

create policy "admins manage staff" on public.staff_allowlist
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "read own profile or staff reads all" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_staff()));

create policy "read own files or staff reads all" on public.files
  for select to authenticated using (owner_id = (select auth.uid()) or (select public.is_staff()));

create policy "read own orders or staff reads all" on public.orders
  for select to authenticated using (student_id = (select auth.uid()) or (select public.is_staff()));

create policy "read items of visible orders" on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id)
  );

create policy "read events of visible orders" on public.order_events
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id)
  );

create policy "manage own push subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- No insert/update/delete policies on profiles, files, orders, items, events
-- or payment_events: those writes go through the functions above or the
-- server's service-role client. Belt and braces on top of RLS:
revoke insert, update, delete on public.profiles, public.files, public.orders, public.order_items,
  public.order_events, public.price_tiers, public.payment_events from anon, authenticated;
revoke all on public.payment_events from anon, authenticated;
-- Signed-out visitors only ever need settings and prices.
revoke all on public.profiles, public.files, public.orders, public.order_items, public.order_events,
  public.push_subscriptions, public.staff_allowlist from anon;
revoke insert, update, delete on public.app_settings from anon;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.email_domain_allowed(text) to anon, authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.no_show_count(public.profiles) to authenticated;
grant execute on function public.save_profile(text, text, text, text, text) to authenticated;
grant execute on function public.place_order(public.payment_method, jsonb, int, text, text, text) to authenticated;
grant execute on function public.cancel_my_order(uuid) to authenticated;
grant execute on function public.rate_order(uuid, int, text) to authenticated;
grant execute on function public.queue_position(uuid) to authenticated;
grant execute on function public.staff_transition_order(uuid, public.order_status, public.order_status, boolean, public.cancel_code, text) to authenticated;
grant execute on function public.set_price_tiers(public.color_mode, jsonb) to authenticated;
grant execute on function public.set_accepting_orders(boolean, text) to authenticated;
grant execute on function public.shop_stats(int) to authenticated;

grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: students and staff get live order updates (RLS still applies)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
