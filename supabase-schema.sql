-- ============================================================
-- Gift Card Manager — Supabase schema
-- Run this once in your project's SQL Editor
-- (Supabase Dashboard → SQL Editor → New query → paste → Run)
-- ============================================================

-- ------------------------------------------------------------
-- 0. Clean slate — drops anything left over from a previous
--    partial run so this script is always safe to re-run.
-- ------------------------------------------------------------
drop table if exists public.receipts cascade;
drop table if exists public.cards cascade;

drop policy if exists "Users read their own receipt images" on storage.objects;
drop policy if exists "Users upload their own receipt images" on storage.objects;
drop policy if exists "Users delete their own receipt images" on storage.objects;

-- ------------------------------------------------------------
-- 1. Cards — one row per physical/digital gift card
-- ------------------------------------------------------------
create table public.cards (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  card_number    text,
  pin            text,
  initial_amount numeric(10,2) not null default 0 check (initial_amount >= 0),
  expiry         date,
  notes          text,
  created_at     timestamptz not null default now()
);

create index if not exists cards_user_id_idx on public.cards(user_id);

-- ------------------------------------------------------------
-- 2. Receipts — one row per purchase logged against a card.
--    "spent" is never stored directly — it's always derived by
--    summing receipts for a card, so it can never drift out of
--    sync the way a manually-incremented counter can.
-- ------------------------------------------------------------
create table public.receipts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  card_id     uuid not null references public.cards(id) on delete cascade,
  amount      numeric(10,2) not null check (amount >= 0),
  image_path  text,
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists receipts_user_id_idx on public.receipts(user_id);
create index if not exists receipts_card_id_idx on public.receipts(card_id);

-- ------------------------------------------------------------
-- 3. Row Level Security — every user can only ever see or
--    touch their own cards and receipts.
-- ------------------------------------------------------------
alter table public.cards enable row level security;
alter table public.receipts enable row level security;

create policy "Users manage their own cards"
  on public.cards for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own receipts"
  on public.receipts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4. Storage bucket for receipt photos (kept private — access
--    is only granted through short-lived signed URLs generated
--    per session, never a public link).
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Files are stored at "<user_id>/<uuid>.<ext>" so a user's folder
-- name doubles as the ownership check below.
create policy "Users read their own receipt images"
  on storage.objects for select
  using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users upload their own receipt images"
  on storage.objects for insert
  with check (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users delete their own receipt images"
  on storage.objects for delete
  using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
