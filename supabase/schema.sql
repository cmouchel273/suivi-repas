create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  updated_at timestamptz not null default now()
);

create table if not exists public.meals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  name text not null,
  calories numeric not null check (calories >= 0),
  proteins numeric not null check (proteins >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.weights (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  weight numeric not null check (weight > 0),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.meals enable row level security;
alter table public.weights enable row level security;

drop policy if exists "Profiles are visible to authenticated users" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Profiles are visible to authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Meals are visible to authenticated users" on public.meals;
drop policy if exists "Users can insert their own meals" on public.meals;

create policy "Meals are visible to authenticated users"
  on public.meals for select
  to authenticated
  using (true);

create policy "Users can insert their own meals"
  on public.meals for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Weights are visible to authenticated users" on public.weights;
drop policy if exists "Users can insert their own weights" on public.weights;

create policy "Weights are visible to authenticated users"
  on public.weights for select
  to authenticated
  using (true);

create policy "Users can insert their own weights"
  on public.weights for insert
  to authenticated
  with check (auth.uid() = user_id);

create index if not exists meals_user_created_at_idx on public.meals (user_id, created_at desc);
create index if not exists weights_user_created_at_idx on public.weights (user_id, created_at desc);
