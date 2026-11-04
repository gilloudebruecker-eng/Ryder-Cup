create table if not exists public.golf_rounds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  round_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.golf_rounds enable row level security;

drop policy if exists "Players can read their own round" on public.golf_rounds;
create policy "Players can read their own round"
on public.golf_rounds for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Players can create their own round" on public.golf_rounds;
create policy "Players can create their own round"
on public.golf_rounds for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Players can update their own round" on public.golf_rounds;
create policy "Players can update their own round"
on public.golf_rounds for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update on table public.golf_rounds to authenticated;

create table if not exists public.golf_round_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  course_id text not null,
  format text not null,
  players jsonb not null,
  played_at timestamptz not null default now()
);

alter table public.golf_round_history enable row level security;
drop policy if exists "Players can read their round history" on public.golf_round_history;
drop policy if exists "Players can add their round history" on public.golf_round_history;
drop policy if exists "Players can delete their round history" on public.golf_round_history;
create policy "Players can read their round history" on public.golf_round_history
for select to authenticated using (user_id = (select auth.uid()));
create policy "Players can add their round history" on public.golf_round_history
for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Players can delete their round history" on public.golf_round_history
for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, delete on table public.golf_round_history to authenticated;

create table if not exists public.golf_started_rounds (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  course_id text not null,
  format text not null,
  players jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.golf_started_rounds enable row level security;
drop policy if exists "Players can manage their started rounds" on public.golf_started_rounds;
create policy "Players can manage their started rounds" on public.golf_started_rounds
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
grant select, insert, update, delete on table public.golf_started_rounds to authenticated;

create table if not exists public.ryder_cups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  team_a_name text not null,
  team_b_name text not null,
  team_size integer not null check (team_size between 1 and 12),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.ryder_cup_members (
  event_id uuid not null references public.ryder_cups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.ryder_matchups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ryder_cups(id) on delete cascade,
  sort_order integer not null,
  format text not null check (format in ('scramble', 'stableford')),
  team_a_players text[] not null,
  team_b_players text[] not null,
  hole_results jsonb not null default '[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (event_id, sort_order)
);

alter table public.ryder_cups enable row level security;
alter table public.ryder_cup_members enable row level security;
alter table public.ryder_matchups enable row level security;

create schema if not exists private;

create or replace function private.is_ryder_member(cup_id uuid)
returns boolean language sql security definer set search_path = ''
as $$ select exists(select 1 from public.ryder_cup_members where event_id = cup_id and user_id = (select auth.uid())) $$;

create or replace function private.add_ryder_creator()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin insert into public.ryder_cup_members(event_id,user_id) values(new.id,new.created_by); return new; end $$;

drop trigger if exists add_ryder_creator on public.ryder_cups;
create trigger add_ryder_creator after insert on public.ryder_cups for each row execute function private.add_ryder_creator();

drop policy if exists "Authenticated users can create Ryder Cups" on public.ryder_cups;
drop policy if exists "Members can view Ryder Cups" on public.ryder_cups;
drop policy if exists "Members can view their membership" on public.ryder_cup_members;
drop policy if exists "Members can view matchups" on public.ryder_matchups;
drop policy if exists "Members can create matchups" on public.ryder_matchups;
drop policy if exists "Members can update matchups" on public.ryder_matchups;

create policy "Authenticated users can create Ryder Cups" on public.ryder_cups
for insert to authenticated with check (created_by = (select auth.uid()));
create policy "Members can view Ryder Cups" on public.ryder_cups
for select to authenticated using ((select private.is_ryder_member(id)));
create policy "Members can view their membership" on public.ryder_cup_members
for select to authenticated using (user_id = (select auth.uid()));
create policy "Members can view matchups" on public.ryder_matchups
for select to authenticated using ((select private.is_ryder_member(event_id)));
create policy "Members can create matchups" on public.ryder_matchups
for insert to authenticated with check ((select private.is_ryder_member(event_id)));
create policy "Members can update matchups" on public.ryder_matchups
for update to authenticated using ((select private.is_ryder_member(event_id)))
with check ((select private.is_ryder_member(event_id)));

create or replace function public.join_ryder_cup(invite_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare cup_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select id into cup_id from public.ryder_cups where join_code = upper(trim(invite_code));
  if cup_id is null then raise exception 'Invalid Ryder Cup code'; end if;
  insert into public.ryder_cup_members(event_id,user_id) values(cup_id,(select auth.uid())) on conflict do nothing;
  return cup_id;
end $$;

revoke all on function public.join_ryder_cup(text) from public;
grant execute on function public.join_ryder_cup(text) to authenticated;

create or replace function public.create_ryder_cup(
  cup_name text,
  invite_code text,
  first_team_name text,
  second_team_name text,
  players_per_team integer
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare new_cup_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if players_per_team < 1 or players_per_team > 12 then raise exception 'Team size must be between 1 and 12'; end if;
  insert into public.ryder_cups(name, join_code, team_a_name, team_b_name, team_size, created_by)
  values(trim(cup_name), upper(trim(invite_code)), trim(first_team_name), trim(second_team_name), players_per_team, auth.uid())
  returning id into new_cup_id;
  return new_cup_id;
end $$;

revoke all on function public.create_ryder_cup(text,text,text,text,integer) from public;
grant execute on function public.create_ryder_cup(text,text,text,text,integer) to authenticated;
grant select, insert on public.ryder_cups to authenticated;
grant select on public.ryder_cup_members to authenticated;
grant select, insert, update on public.ryder_matchups to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.ryder_matchups;
exception when duplicate_object then null;
end $$;

create table if not exists public.ryder_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ryder_cups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  unique(event_id, endpoint)
);

alter table public.ryder_push_subscriptions enable row level security;
drop policy if exists "Members manage their push subscriptions" on public.ryder_push_subscriptions;
create policy "Members manage their push subscriptions" on public.ryder_push_subscriptions
for all to authenticated
using (user_id = (select auth.uid()) and (select private.is_ryder_member(event_id)))
with check (user_id = (select auth.uid()) and (select private.is_ryder_member(event_id)));
grant select, insert, update, delete on table public.ryder_push_subscriptions to authenticated;
