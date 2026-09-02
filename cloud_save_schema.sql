-- ============================================================
-- Chase Studios / UniMon Legends - Cloud Save Schema
--
-- Run this once in your Supabase project's SQL Editor
-- (https://supabase.com/dashboard/project/rvetucuqburqnrgoatui/sql/new).
-- Safe to re-run: tables use IF NOT EXISTS, policies/triggers are
-- dropped and recreated, and the backfill insert is idempotent.
-- ============================================================

-- ---------- profiles: one row per account ----------
create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    email text,
    welcome_bundle_claimed boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
    on public.profiles for select
    using (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
    on public.profiles for insert
    with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
    on public.profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- ---------- player_saves: one unified cloud save per account ----------
create table if not exists public.player_saves (
    user_id uuid primary key references auth.users (id) on delete cascade,
    save_data jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.player_saves enable row level security;

drop policy if exists "Users can view their own save" on public.player_saves;
create policy "Users can view their own save"
    on public.player_saves for select
    using (auth.uid() = user_id);

drop policy if exists "Users can insert their own save" on public.player_saves;
create policy "Users can insert their own save"
    on public.player_saves for insert
    with check (auth.uid() = user_id);

drop policy if exists "Users can update their own save" on public.player_saves;
create policy "Users can update their own save"
    on public.player_saves for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- ---------- keep updated_at accurate server-side (avoids client clock skew,
-- which the game relies on to detect "this cloud save is newer than my local copy") ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
    before update on public.profiles
    for each row execute function public.set_updated_at();

drop trigger if exists set_player_saves_updated_at on public.player_saves;
create trigger set_player_saves_updated_at
    before update on public.player_saves
    for each row execute function public.set_updated_at();

-- ---------- auto-create a profile row for every new signup ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, email)
    values (new.id, new.email)
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------- backfill profiles for any accounts created before this migration
-- (e.g. anyone who already signed up through the chase-studios-portal site) ----------
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;
