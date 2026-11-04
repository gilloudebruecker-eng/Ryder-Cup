create table if not exists public.shared_golf_rounds (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id text not null check (course_id in ('keerbergen','oostburg','zoute-championship','zoute-executive')),
  format text not null default 'stableford' check (format in ('stableford','matchplay','matchplay2v2','fourball','amerikaantje')),
  players jsonb not null,
  hole_index integer not null default 0 check (hole_index between 0 and 17),
  round_started boolean not null default true,
  finished boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_golf_round_members (
  round_id uuid not null references public.shared_golf_rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (round_id, user_id)
);

alter table public.shared_golf_rounds enable row level security;
alter table public.shared_golf_round_members enable row level security;
alter table public.shared_golf_rounds drop constraint if exists shared_golf_rounds_format_check;
alter table public.shared_golf_rounds add constraint shared_golf_rounds_format_check
check (format in ('stableford','matchplay','matchplay2v2','fourball','amerikaantje'));
create schema if not exists private;

create or replace function private.is_shared_round_member(target_round uuid)
returns boolean language sql security definer set search_path = ''
as $$
  select exists(
    select 1 from public.shared_golf_round_members
    where round_id = target_round and user_id = (select auth.uid())
  )
$$;

create or replace function public.create_shared_golf_round(
  invite_code text,
  selected_course_id text,
  selected_format text,
  round_players jsonb
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare new_round_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if selected_course_id not in ('keerbergen','oostburg','zoute-championship','zoute-executive') then
    raise exception 'Invalid course';
  end if;
  if selected_format not in ('stableford','matchplay','matchplay2v2','fourball','amerikaantje') then
    raise exception 'Invalid game format';
  end if;
  if jsonb_typeof(round_players) <> 'array' or jsonb_array_length(round_players) < 1 or jsonb_array_length(round_players) > 4 then
    raise exception 'A shared round needs 1 to 4 players';
  end if;
  insert into public.shared_golf_rounds(join_code,created_by,course_id,format,players)
  values(upper(trim(invite_code)),auth.uid(),selected_course_id,selected_format,round_players)
  returning id into new_round_id;
  insert into public.shared_golf_round_members(round_id,user_id)
  values(new_round_id,auth.uid());
  return new_round_id;
end $$;

create or replace function public.join_shared_golf_round(invite_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select id into target_id from public.shared_golf_rounds
  where join_code = upper(trim(invite_code)) and finished = false;
  if target_id is null then raise exception 'Invalid or finished shared-round code'; end if;
  insert into public.shared_golf_round_members(round_id,user_id)
  values(target_id,auth.uid()) on conflict do nothing;
  return target_id;
end $$;

drop policy if exists "Members view shared rounds" on public.shared_golf_rounds;
drop policy if exists "Members update shared rounds" on public.shared_golf_rounds;
drop policy if exists "Users view own shared memberships" on public.shared_golf_round_members;
create policy "Members view shared rounds" on public.shared_golf_rounds
for select to authenticated using ((select private.is_shared_round_member(id)));
create policy "Members update shared rounds" on public.shared_golf_rounds
for update to authenticated using ((select private.is_shared_round_member(id)))
with check ((select private.is_shared_round_member(id)));
create policy "Users view own shared memberships" on public.shared_golf_round_members
for select to authenticated using (user_id = (select auth.uid()));

drop function if exists public.create_shared_golf_round(text,text,jsonb);
revoke all on function public.create_shared_golf_round(text,text,text,jsonb) from public;
revoke all on function public.join_shared_golf_round(text) from public;
grant execute on function public.create_shared_golf_round(text,text,text,jsonb) to authenticated;
grant execute on function public.join_shared_golf_round(text) to authenticated;
grant select, update on public.shared_golf_rounds to authenticated;
grant select on public.shared_golf_round_members to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.shared_golf_rounds;
exception when duplicate_object then null;
end $$;
