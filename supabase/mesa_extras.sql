-- ============================================================
-- Mesa de Rol — VTT · Plantillas de área, zonas exploradas y audio
-- Requiere schema.sql y security.sql. Re-ejecutable.
-- ============================================================

-- ---------- Plantillas de área (cono, círculo, línea, cubo) ----------
create table if not exists public.templates ( id text primary key, data jsonb not null, updated_at timestamptz not null default now() );
alter table public.templates enable row level security;
create index if not exists templates_game on public.templates ((data->>'gameId'));
do $$ begin
  create trigger touch_templates before update on public.templates for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

drop policy if exists templates_select on public.templates;
drop policy if exists templates_insert on public.templates;
drop policy if exists templates_update on public.templates;
drop policy if exists templates_delete on public.templates;
-- Las ven los miembros de la partida; cualquiera de ellos crea las suyas; las borra su autor o el DM
create policy templates_select on public.templates for select to authenticated
  using (public.is_game_member(data->>'gameId'));
create policy templates_insert on public.templates for insert to authenticated
  with check (data->>'uid' = auth.uid()::text and public.is_game_member(data->>'gameId')
              and octet_length(data::text) <= 2000);
create policy templates_update on public.templates for update to authenticated
  using (data->>'uid' = auth.uid()::text or public.is_game_dm(data->>'gameId'))
  with check ((data->>'uid' = auth.uid()::text or public.is_game_dm(data->>'gameId')) and octet_length(data::text) <= 2000);
create policy templates_delete on public.templates for delete to authenticated
  using (data->>'uid' = auth.uid()::text or public.is_game_dm(data->>'gameId'));

do $$ begin
  alter publication supabase_realtime add table public.templates;
exception when duplicate_object then null; end $$;

-- ---------- Zonas exploradas: una fila por jugador y mapa ----------
create table if not exists public.explored (
  user_id uuid not null default auth.uid(),
  map_id text not null,
  game_id text,
  data jsonb not null,          -- { ts, png } (máscara en PNG a 1/4 de resolución)
  updated_at timestamptz not null default now(),
  primary key (user_id, map_id)
);
alter table public.explored enable row level security;
do $$ begin
  create trigger touch_explored before update on public.explored for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

drop policy if exists explored_select on public.explored;
drop policy if exists explored_insert on public.explored;
drop policy if exists explored_update on public.explored;
drop policy if exists explored_delete on public.explored;
create policy explored_select on public.explored for select to authenticated using (user_id = auth.uid());
create policy explored_insert on public.explored for insert to authenticated
  with check (user_id = auth.uid() and public.is_game_member(game_id) and octet_length(data::text) <= 1000000);
create policy explored_update on public.explored for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_game_member(game_id) and octet_length(data::text) <= 1000000);
create policy explored_delete on public.explored for delete to authenticated
  using (user_id = auth.uid() or public.is_game_dm(game_id));

-- ---------- Audio: permitir subir música y ambientes al bucket ----------
update storage.buckets
   set allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','video/webm','video/mp4',
                                  'audio/mpeg','audio/mp3','audio/ogg','audio/wav','audio/x-wav','audio/wave',
                                  'audio/webm','audio/mp4','audio/aac','audio/x-m4a','audio/flac']
 where id = 'assets';

-- Al borrar una cuenta, borrar también sus zonas exploradas y plantillas
-- (las filas de explored van con user_id; las plantillas, por el uid en data)
create or replace function public._cleanup_user_extras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.explored where user_id = old.id;
  delete from public.templates where data->>'uid' = old.id::text;
  return old;
end $$;
do $$ begin
  create trigger cleanup_user_extras after delete on auth.users for each row execute function public._cleanup_user_extras();
exception when duplicate_object then null; when insufficient_privilege then null; end $$;
