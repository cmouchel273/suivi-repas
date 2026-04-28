create table if not exists public.activity_reactions (
  target_type text not null check (target_type in ('meal', 'weight')),
  target_id bigint not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (target_type, target_id, user_id)
);

create or replace function public.set_activity_reactions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_activity_reactions_updated_at
  on public.activity_reactions;

create trigger set_activity_reactions_updated_at
before update on public.activity_reactions
for each row
execute function public.set_activity_reactions_updated_at();

alter table public.activity_reactions enable row level security;

drop policy if exists "Activity reactions are visible to authenticated users"
  on public.activity_reactions;
drop policy if exists "Users can insert their own activity reactions"
  on public.activity_reactions;
drop policy if exists "Users can update their own activity reactions"
  on public.activity_reactions;
drop policy if exists "Users can delete their own activity reactions"
  on public.activity_reactions;

create policy "Activity reactions are visible to authenticated users"
  on public.activity_reactions for select
  to authenticated
  using (true);

create policy "Users can insert their own activity reactions"
  on public.activity_reactions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own activity reactions"
  on public.activity_reactions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own activity reactions"
  on public.activity_reactions for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists activity_reactions_target_idx
  on public.activity_reactions (target_type, target_id);

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  )
  and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'activity_reactions'
  ) then
    alter publication supabase_realtime add table public.activity_reactions;
  end if;
end;
$$;
