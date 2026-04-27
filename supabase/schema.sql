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
  photo_path text,
  created_at timestamptz not null default now()
);

alter table public.meals
  add column if not exists photo_path text;

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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meal-photos',
  'meal-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Meal photos are visible to authenticated users" on storage.objects;
drop policy if exists "Users can upload their own meal photos" on storage.objects;
drop policy if exists "Users can update their own meal photos" on storage.objects;
drop policy if exists "Users can delete their own meal photos" on storage.objects;

create policy "Meal photos are visible to authenticated users"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'meal-photos');

create policy "Users can upload their own meal photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'meal-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own meal photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'meal-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'meal-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own meal photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'meal-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create index if not exists meals_user_created_at_idx on public.meals (user_id, created_at desc);
create index if not exists weights_user_created_at_idx on public.weights (user_id, created_at desc);
