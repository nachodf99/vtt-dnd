-- ============================================================
-- Mesa de Rol — VTT · Esquema Supabase
-- Ejecutar ENTERO en el SQL Editor de CADA proyecto (prod y dev).
-- Es idempotente: se puede volver a ejecutar sin romper nada.
-- ============================================================

-- Tablas: documentos jsonb con id de texto
create table if not exists public.games  ( id text primary key, data jsonb not null, updated_at timestamptz not null default now() );
create table if not exists public.maps   ( id text primary key, data jsonb not null, updated_at timestamptz not null default now() );
create table if not exists public.tokens ( id text primary key, data jsonb not null, updated_at timestamptz not null default now() );
create table if not exists public.rolls  ( id text primary key, data jsonb not null, updated_at timestamptz not null default now() );

create index if not exists tokens_game on public.tokens ((data->>'gameId'));
create index if not exists rolls_game  on public.rolls  ((data->>'gameId'));

-- updated_at automático
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
do $$ declare t text;
begin
  foreach t in array array['games','maps','tokens','rolls'] loop
    execute format('drop trigger if exists touch_%I on public.%I', t, t);
    execute format('create trigger touch_%I before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- RLS
alter table public.games  enable row level security;
alter table public.maps   enable row level security;
alter table public.tokens enable row level security;
alter table public.rolls  enable row level security;

-- limpiar políticas previas (re-ejecución segura)
do $$ declare pol record;
begin
  for pol in select policyname, tablename from pg_policies where schemaname='public' and tablename in ('games','maps','tokens','rolls') loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- games: todos leen; crea cualquiera autenticado (como su DM); solo su DM modifica/borra
create policy games_select on public.games for select using (true);
create policy games_insert on public.games for insert to authenticated
  with check (data->>'dmId' = auth.uid()::text);
create policy games_update on public.games for update to authenticated
  using (data->>'dmId' = auth.uid()::text)
  with check (data->>'dmId' = auth.uid()::text);
create policy games_delete on public.games for delete to authenticated
  using (data->>'dmId' = auth.uid()::text);

-- maps: todos leen; solo su dueño escribe
create policy maps_select on public.maps for select using (true);
create policy maps_insert on public.maps for insert to authenticated
  with check (data->>'ownerId' = auth.uid()::text);
create policy maps_update on public.maps for update to authenticated
  using (data->>'ownerId' = auth.uid()::text)
  with check (data->>'ownerId' = auth.uid()::text);
create policy maps_delete on public.maps for delete to authenticated
  using (data->>'ownerId' = auth.uid()::text);

-- tokens: todos leen; solo el DM de la partida del token escribe
create policy tokens_select on public.tokens for select using (true);
create policy tokens_insert on public.tokens for insert to authenticated
  with check (exists (select 1 from public.games g where g.id = data->>'gameId' and g.data->>'dmId' = auth.uid()::text));
create policy tokens_update on public.tokens for update to authenticated
  using (exists (select 1 from public.games g where g.id = data->>'gameId' and g.data->>'dmId' = auth.uid()::text))
  with check (exists (select 1 from public.games g where g.id = data->>'gameId' and g.data->>'dmId' = auth.uid()::text));
create policy tokens_delete on public.tokens for delete to authenticated
  using (exists (select 1 from public.games g where g.id = data->>'gameId' and g.data->>'dmId' = auth.uid()::text));

-- rolls: todos leen; cada cual publica sus tiradas/mensajes; borra el autor o el DM de la partida
create policy rolls_select on public.rolls for select using (true);
create policy rolls_insert on public.rolls for insert to authenticated
  with check (data->>'uid' = auth.uid()::text);
create policy rolls_delete on public.rolls for delete to authenticated
  using (data->>'uid' = auth.uid()::text
         or exists (select 1 from public.games g where g.id = data->>'gameId' and g.data->>'dmId' = auth.uid()::text));

-- Realtime: publicar cambios de las 4 tablas
do $$ declare t text;
begin
  foreach t in array array['games','maps','tokens','rolls'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Storage: bucket público "assets" (mapas e imágenes de token)
insert into storage.buckets (id, name, public) values ('assets','assets', true)
  on conflict (id) do nothing;
do $$
begin
  begin
    create policy assets_read on storage.objects for select using (bucket_id = 'assets');
  exception when duplicate_object then null; end;
  begin
    create policy assets_write on storage.objects for insert to authenticated with check (bucket_id = 'assets');
  exception when duplicate_object then null; end;
end $$;

-- Recordatorio (no es SQL): activa "Anonymous sign-ins" en
-- Authentication → Sign In / Up → Anonymous, en cada proyecto.
