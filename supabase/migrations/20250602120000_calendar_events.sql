-- Calendar events for the flashcards app
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_events_user_id_idx
  on public.calendar_events (user_id);

create index if not exists calendar_events_starts_at_idx
  on public.calendar_events (starts_at);

alter table public.calendar_events enable row level security;

create policy "Users can view own calendar events"
  on public.calendar_events
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own calendar events"
  on public.calendar_events
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own calendar events"
  on public.calendar_events
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own calendar events"
  on public.calendar_events
  for delete
  using (auth.uid() = user_id);

create or replace function public.set_calendar_events_user_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists calendar_events_set_user_id on public.calendar_events;

create trigger calendar_events_set_user_id
  before insert or update on public.calendar_events
  for each row
  execute function public.set_calendar_events_user_id();
