alter table public.profiles
  add column if not exists pseudo text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_pseudo_length'
  ) then
    alter table public.profiles
      add constraint profiles_pseudo_length
      check (pseudo is null or char_length(pseudo) <= 32);
  end if;
end;
$$;
