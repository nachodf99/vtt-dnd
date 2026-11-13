-- ============================================================
-- Mesa de Rol — VTT · Seguridad, miembros, perfiles y mapas por partida
-- Ejecutar después de schema.sql, rounds.sql, combat_v2.sql, items.sql,
-- effects.sql y equipment.sql. Es idempotente.
-- ============================================================

-- ---------- 1. Miembros de cada partida y códigos secretos ----------
create table if not exists public.game_members (
  game_id   text not null references public.games(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  name      text,
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
create index if not exists game_members_user on public.game_members (user_id);

create table if not exists public.game_secrets (
  game_id text primary key references public.games(id) on delete cascade,
  code    text not null unique
);

create table if not exists public.join_attempts (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists join_attempts_user on public.join_attempts (user_id, at);

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.game_members  enable row level security;
alter table public.game_secrets  enable row level security;
alter table public.join_attempts enable row level security;
alter table public.profiles      enable row level security;

-- Pasar los códigos que estaban dentro de games.data (visibles para todos) a la tabla secreta
insert into public.game_secrets (game_id, code)
select id, upper(data->>'code') from public.games
where coalesce(data->>'code', '') <> ''
on conflict do nothing;
update public.games set data = (data - 'code') || jsonb_build_object('private', true)
where coalesce(data->>'code', '') <> '';

-- El DM es miembro de su partida
insert into public.game_members (game_id, user_id, name)
select g.id, (g.data->>'dmId')::uuid, 'DM' from public.games g
where g.data->>'dmId' ~ '^[0-9a-f-]{36}$' and exists (select 1 from auth.users u where u.id = (g.data->>'dmId')::uuid)
on conflict do nothing;
-- Los jugadores que ya tenían un PJ asignado pasan a ser miembros
insert into public.game_members (game_id, user_id, name)
select distinct on (t.data->>'gameId', t.data->>'ownerId') t.data->>'gameId', (t.data->>'ownerId')::uuid, left(t.data->>'ownerName', 40)
from public.tokens t
where t.data->>'ownerId' ~ '^[0-9a-f-]{36}$'
  and exists (select 1 from public.games g where g.id = t.data->>'gameId')
  and exists (select 1 from auth.users u where u.id = (t.data->>'ownerId')::uuid)
on conflict do nothing;

-- Nunca guardar el código dentro de games.data
create or replace function public._games_strip_code() returns trigger
language plpgsql set search_path = public as $$
begin
  new.data := new.data - 'code';
  return new;
end $$;
drop trigger if exists games_strip_code on public.games;
create trigger games_strip_code before insert or update on public.games
  for each row execute function public._games_strip_code();

-- ---------- 2. Funciones de permiso ----------
create or replace function public.is_game_dm(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.games g where g.id = gid and g.data->>'dmId' = auth.uid()::text);
$$;

create or replace function public.is_game_member(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.game_members m where m.game_id = gid and m.user_id = auth.uid())
    or exists (select 1 from public.games g where g.id = gid and g.data->>'dmId' = auth.uid()::text));
$$;

-- ---------- 3. Políticas de las tablas ----------
do $$ declare pol record;
begin
  for pol in select policyname, tablename from pg_policies
             where schemaname = 'public' and tablename in ('games','maps','tokens','rolls','game_members','game_secrets','join_attempts','profiles') loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- games: solo la ven sus miembros; se crean con create_game(); solo el DM modifica/borra
create policy games_select on public.games for select to authenticated using (public.is_game_member(id));
create policy games_update on public.games for update to authenticated
  using (data->>'dmId' = auth.uid()::text) with check (data->>'dmId' = auth.uid()::text);
create policy games_delete on public.games for delete to authenticated
  using (data->>'dmId' = auth.uid()::text);

-- members: cada uno ve su fila; el DM ve y puede expulsar a los de su partida; uno puede salirse
create policy members_select on public.game_members for select to authenticated
  using (user_id = auth.uid() or public.is_game_dm(game_id));
create policy members_delete on public.game_members for delete to authenticated
  using (user_id = auth.uid() or public.is_game_dm(game_id));

-- secretos: solo el DM
create policy secrets_select on public.game_secrets for select to authenticated using (public.is_game_dm(game_id));

-- perfiles: cada uno el suyo
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- maps: pertenecen a una partida (data.gameId). Los ve su dueño y los miembros de esa partida.
update public.maps m set data = m.data || jsonb_build_object('gameId', g.id)
from public.games g
where g.data->>'activeMapId' = m.id and coalesce(m.data->>'gameId', '') = '';
create index if not exists maps_game on public.maps ((data->>'gameId'));
create policy maps_select on public.maps for select to authenticated
  using (data->>'ownerId' = auth.uid()::text or public.is_game_member(data->>'gameId'));
create policy maps_insert on public.maps for insert to authenticated
  with check (data->>'ownerId' = auth.uid()::text and (coalesce(data->>'gameId', '') = '' or public.is_game_dm(data->>'gameId')));
create policy maps_update on public.maps for update to authenticated
  using (data->>'ownerId' = auth.uid()::text)
  with check (data->>'ownerId' = auth.uid()::text and (coalesce(data->>'gameId', '') = '' or public.is_game_dm(data->>'gameId')));
create policy maps_delete on public.maps for delete to authenticated
  using (data->>'ownerId' = auth.uid()::text);

-- tokens: el DM lo ve todo; los miembros solo lo que no está oculto. Solo el DM escribe.
create policy tokens_select on public.tokens for select to authenticated
  using (public.is_game_dm(data->>'gameId')
         or (public.is_game_member(data->>'gameId') and not coalesce((data->>'hidden')::boolean, false)));
create policy tokens_insert on public.tokens for insert to authenticated
  with check (public.is_game_dm(data->>'gameId'));
create policy tokens_update on public.tokens for update to authenticated
  using (public.is_game_dm(data->>'gameId')) with check (public.is_game_dm(data->>'gameId'));
create policy tokens_delete on public.tokens for delete to authenticated
  using (public.is_game_dm(data->>'gameId'));

-- rolls: los miembros leen lo público; lo privado solo el autor y el DM. Publicar solo en tus partidas.
create policy rolls_select on public.rolls for select to authenticated
  using (public.is_game_member(data->>'gameId')
         and (not coalesce((data->>'priv')::boolean, false) or data->>'uid' = auth.uid()::text or public.is_game_dm(data->>'gameId')));
create policy rolls_insert on public.rolls for insert to authenticated
  with check (data->>'uid' = auth.uid()::text and public.is_game_member(data->>'gameId')
              and octet_length(data::text) <= 4000);
create policy rolls_delete on public.rolls for delete to authenticated
  using (data->>'uid' = auth.uid()::text or public.is_game_dm(data->>'gameId'));

-- ---------- 4. RPC de partidas ----------
create or replace function public._new_code() returns text
language plpgsql volatile set search_path = public as $$
declare c text; i int;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1);
    end loop;
    exit when not exists (select 1 from public.game_secrets where code = c);
  end loop;
  return c;
end $$;

create or replace function public.create_game(gname text, priv boolean, pname text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare gid text := gen_random_uuid()::text; c text := null; n int;
begin
  if auth.uid() is null then raise exception 'No has iniciado sesión'; end if;
  gname := left(btrim(coalesce(gname, '')), 60);
  if gname = '' then raise exception 'Ponle nombre a la partida'; end if;
  select count(*) into n from public.games where data->>'dmId' = auth.uid()::text;
  if n >= 50 then raise exception 'Has llegado al máximo de 50 partidas'; end if;
  insert into public.games (id, data) values (gid, jsonb_build_object(
    'name', gname, 'dmId', auth.uid()::text, 'activeMapId', null, 'private', coalesce(priv, false),
    'combat', jsonb_build_object('active', false, 'round', 1, 'turn', 0, 'entries', '[]'::jsonb),
    'createdAt', (extract(epoch from clock_timestamp()) * 1000)::bigint));
  insert into public.game_members (game_id, user_id, name) values (gid, auth.uid(), left(coalesce(pname, 'DM'), 40));
  if coalesce(priv, false) then
    c := public._new_code();
    insert into public.game_secrets (game_id, code) values (gid, c);
  end if;
  return jsonb_build_object('id', gid, 'code', c);
end $$;

create or replace function public.set_game_private(gid text, priv boolean) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_game_dm(gid) then raise exception 'Solo el DM'; end if;
  if priv then
    select code into c from public.game_secrets where game_id = gid;
    if c is null then c := public._new_code(); insert into public.game_secrets (game_id, code) values (gid, c); end if;
  else
    delete from public.game_secrets where game_id = gid;
  end if;
  update public.games set data = data || jsonb_build_object('private', priv) where id = gid;
  return c;
end $$;

create or replace function public.regen_game_code(gid text) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_game_dm(gid) then raise exception 'Solo el DM'; end if;
  c := public._new_code();
  insert into public.game_secrets (game_id, code) values (gid, c)
  on conflict (game_id) do update set code = excluded.code;
  update public.games set data = data || jsonb_build_object('private', true) where id = gid;
  return c;
end $$;

-- Unirse. Los errores se DEVUELVEN (no se lanzan) para que el intento fallido quede registrado:
-- máximo 10 intentos fallidos cada 15 minutos por usuario (freno a la fuerza bruta de códigos).
create or replace function public.join_game(gid text, gcode text, pname text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g jsonb; real_code text; n int;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'No has iniciado sesión'); end if;
  select data into g from public.games where id = gid;
  if g is not null and public.is_game_member(gid) then
    return jsonb_build_object('id', gid, 'dm', g->>'dmId' = auth.uid()::text);
  end if;
  delete from public.join_attempts where at < now() - interval '1 day';
  select count(*) into n from public.join_attempts where user_id = auth.uid() and at > now() - interval '15 minutes';
  if n >= 10 then return jsonb_build_object('error', 'Demasiados intentos. Espera unos minutos.'); end if;
  if g is not null then select code into real_code from public.game_secrets where game_id = gid; end if;
  if g is null or (real_code is not null and upper(btrim(coalesce(gcode, ''))) is distinct from real_code) then
    insert into public.join_attempts (user_id) values (auth.uid());
    return jsonb_build_object('error', 'Esa partida no existe o el código no es correcto');
  end if;
  insert into public.game_members (game_id, user_id, name) values (gid, auth.uid(), left(coalesce(nullif(btrim(pname), ''), 'Jugador'), 40))
  on conflict (game_id, user_id) do update set name = excluded.name;
  return jsonb_build_object('id', gid, 'dm', g->>'dmId' = auth.uid()::text);
end $$;

create or replace function public.join_by_code(gcode text, pname text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare gid text; n int;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'No has iniciado sesión'); end if;
  select count(*) into n from public.join_attempts where user_id = auth.uid() and at > now() - interval '15 minutes';
  if n >= 10 then return jsonb_build_object('error', 'Demasiados intentos. Espera unos minutos.'); end if;
  select game_id into gid from public.game_secrets where code = upper(btrim(coalesce(gcode, '')));
  if gid is null then
    insert into public.join_attempts (user_id) values (auth.uid());
    return jsonb_build_object('error', 'Código incorrecto');
  end if;
  return public.join_game(gid, gcode, pname);
end $$;
drop function if exists public._join_throttle();

-- Lobby: partidas públicas + las tuyas. Nunca devuelve códigos.
create or replace function public.list_games() returns table (
  id text, name text, private boolean, dm_name text, players int, created_at bigint, is_dm boolean, is_member boolean, active_map text)
language sql stable security definer set search_path = public as $$
  select g.id, g.data->>'name', coalesce((g.data->>'private')::boolean, false),
         (select m.name from public.game_members m where m.game_id = g.id and m.user_id::text = g.data->>'dmId'),
         (select count(*)::int from public.game_members m where m.game_id = g.id and m.user_id::text <> g.data->>'dmId'),
         coalesce((g.data->>'createdAt')::bigint, 0),
         g.data->>'dmId' = auth.uid()::text,
         exists (select 1 from public.game_members m where m.game_id = g.id and m.user_id = auth.uid()),
         (select mp.data->>'name' from public.maps mp where mp.id = g.data->>'activeMapId')
  from public.games g
  where auth.uid() is not null
    and (not coalesce((g.data->>'private')::boolean, false)
         or g.data->>'dmId' = auth.uid()::text
         or exists (select 1 from public.game_members m where m.game_id = g.id and m.user_id = auth.uid()))
  order by coalesce((g.data->>'createdAt')::bigint, 0) desc
  limit 200;
$$;

create or replace function public.leave_game(gid text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if public.is_game_dm(gid) then raise exception 'El DM no puede abandonar su propia partida (puede borrarla)'; end if;
  update public.tokens set data = data - 'ownerId' - 'ownerName'
   where data->>'gameId' = gid and data->>'ownerId' = auth.uid()::text;
  delete from public.game_members where game_id = gid and user_id = auth.uid();
  return true;
end $$;

-- Mis personajes en todas mis partidas (para el perfil)
create or replace function public.my_characters() returns table (game_id text, game_name text, token_id text, name text, cls text, race text, lvl int, hp int, hp_max int, map_name text)
language sql stable security definer set search_path = public as $$
  select t.data->>'gameId', g.data->>'name', t.id, t.data->>'name', t.data->>'cls', t.data->>'race',
         public._level_for(coalesce((t.data->>'xp')::int, 0)), (t.data->>'hp')::int, (t.data->>'hpMax')::int,
         (select mp.data->>'name' from public.maps mp where mp.id = t.data->>'mapId')
  from public.tokens t join public.games g on g.id = t.data->>'gameId'
  where auth.uid() is not null and t.data->>'ownerId' = auth.uid()::text
  order by g.data->>'name';
$$;

-- claim_token: además, hay que ser miembro de la partida
create or replace function public.claim_token(tid text, pname text) returns boolean
language plpgsql security definer set search_path = public as $$
declare gid text; ok boolean;
begin
  if auth.uid() is null then return false; end if;
  select data->>'gameId' into gid from public.tokens
   where id = tid and data->>'type' = 'pc' and coalesce(data->>'ownerId', '') = '' and not coalesce((data->>'hidden')::boolean, false);
  if gid is null or not public.is_game_member(gid) then return false; end if;
  update public.tokens set data = (data - 'ownerId' - 'ownerName') where data->>'gameId' = gid and data->>'ownerId' = auth.uid()::text;
  update public.tokens set data = data || jsonb_build_object('ownerId', auth.uid()::text, 'ownerName', left(coalesce(nullif(btrim(pname), ''), 'Jugador'), 24))
   where id = tid and coalesce(data->>'ownerId', '') = '';
  get diagnostics ok = row_count;
  return ok;
end $$;

-- Borrar mi cuenta y todo lo mío (derecho de supresión)
create or replace function public.delete_my_account() returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); gids text[];
begin
  if uid is null then raise exception 'No has iniciado sesión'; end if;
  select coalesce(array_agg(id), '{}') into gids from public.games where data->>'dmId' = uid::text;
  delete from public.tokens where data->>'gameId' = any(gids);
  delete from public.rolls where data->>'gameId' = any(gids) or data->>'uid' = uid::text;
  delete from public.games where id = any(gids);
  delete from public.maps where data->>'ownerId' = uid::text;
  update public.tokens set data = data - 'ownerId' - 'ownerName' where data->>'ownerId' = uid::text;
  begin
    delete from storage.objects where bucket_id = 'assets' and (storage.foldername(name))[1] = uid::text;
  exception when others then null; -- si Storage no permite borrar por SQL, los archivos quedan huérfanos (URLs aleatorias)
  end;
  delete from auth.users where id = uid;
  return true;
end $$;

-- ---------- 5. Almacenamiento de archivos ----------
update storage.buckets
   set public = true,
       file_size_limit = 52428800,
       allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','video/webm','video/mp4']
 where id = 'assets';
drop policy if exists assets_read on storage.objects;
drop policy if exists assets_write on storage.objects;
drop policy if exists assets_delete on storage.objects;
-- Subir solo dentro de tu propia carpeta (<uid>/...). Sin política SELECT: nadie puede listar archivos ajenos;
-- las imágenes se sirven por su URL pública, que lleva un identificador aleatorio.
create policy assets_write on storage.objects for insert to authenticated
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'assets' and owner = auth.uid());

-- ---------- 6. Canales en tiempo real privados (presencia, señales) ----------
drop policy if exists game_channel_read on realtime.messages;
drop policy if exists game_channel_write on realtime.messages;
create policy game_channel_read on realtime.messages for select to authenticated
  using (realtime.topic() like 'game-%' and public.is_game_member(substring(realtime.topic() from 6)));
create policy game_channel_write on realtime.messages for insert to authenticated
  with check (realtime.topic() like 'game-%' and public.is_game_member(substring(realtime.topic() from 6)));

-- ---------- 7. Permisos mínimos ----------
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke insert, update, delete on public.items, public.attacks from authenticated;
revoke all on public.game_secrets, public.join_attempts from authenticated;
grant select on public.game_secrets to authenticated;
grant select, delete on public.game_members to authenticated;
grant select, insert, update on public.profiles to authenticated;
revoke all on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke all on tables from anon;

do $$ declare f text;
begin
  -- funciones que el cliente puede llamar
  foreach f in array array[
    'is_game_dm(text)', 'is_game_member(text)', 'claim_token(text,text)', 'release_token(text)',
    'round_move_roll(text)', 'round_move_commit(text,numeric,numeric)', 'round_attack(text,text,text)', 'round_pass(text)',
    'inv_use(text,text)', 'inv_drop(text,text)', 'item_use(text,text,text)', 'item_equip(text,text,boolean)',
    'token_recalc(text)', 'dm_round_tick(text)',
    'create_game(text,boolean,text)', 'set_game_private(text,boolean)', 'regen_game_code(text)',
    'join_game(text,text,text)', 'join_by_code(text,text)', 'list_games()', 'leave_game(text)',
    'my_characters()', 'delete_my_account()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- funciones internas: nadie desde fuera
end $$;

-- ---------- 8. Bloquear TODAS las funciones internas y abrir solo las que usa la app ----------
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from authenticated;
do $$ declare f text;
begin
  foreach f in array array[
    'is_game_dm(text)', 'is_game_member(text)', 'claim_token(text,text)', 'release_token(text)',
    'round_move_roll(text)', 'round_move_commit(text,numeric,numeric)', 'round_attack(text,text,text)', 'round_pass(text)',
    'inv_use(text,text)', 'inv_drop(text,text)', 'item_use(text,text,text)', 'item_equip(text,text,boolean)',
    'token_recalc(text)', 'dm_round_tick(text)',
    'create_game(text,boolean,text)', 'set_game_private(text,boolean)', 'regen_game_code(text)',
    'join_game(text,text,text)', 'join_by_code(text,text)', 'list_games()', 'leave_game(text)',
    'my_characters()', 'delete_my_account()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
alter function public._level_for(int) set search_path = public;
alter function public._class_hp(text) set search_path = public;
alter function public._class_abil(text) set search_path = public;
alter function public.touch_updated_at() set search_path = public;
drop policy if exists join_attempts_none on public.join_attempts;
create policy join_attempts_none on public.join_attempts for select to authenticated using (false);
