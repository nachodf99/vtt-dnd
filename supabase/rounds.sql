-- ============================================================
-- Mesa de Rol — VTT · Rondas libres, combate e inventario
-- Reglas autoritativas en el servidor (los móviles no pueden hacer trampa).
-- Re-ejecutable. Aplicar en dev; promover a prod junto con el código.
-- ============================================================

-- Tirada de dados: "1d8+3", "2d6", "d20", "1d6+1"
create or replace function public.roll_dice(expr text) returns int
language plpgsql volatile set search_path = public as $$
declare m text[]; total int := 0; n int; f int; s int; i int;
begin
  expr := lower(replace(coalesce(nullif(expr,''),'1d6'),' ',''));
  for m in select regexp_matches(expr, '([+-]?)(\d*)d(\d+)|([+-]?)(\d+)', 'g') loop
    if m[3] is not null then
      s := case when m[1] = '-' then -1 else 1 end;
      n := least(greatest(coalesce(nullif(m[2],'')::int, 1), 1), 50);
      f := least(greatest(m[3]::int, 2), 1000);
      for i in 1..n loop total := total + s * (1 + floor(random() * f)::int); end loop;
    elsif m[5] is not null then
      s := case when m[4] = '-' then -1 else 1 end;
      total := total + s * m[5]::int;
    end if;
  end loop;
  return total;
end $$;

-- Comprobaciones comunes: es tu PJ, la ronda está abierta y aún no has actuado
create or replace function public._round_check(tid text, out tok jsonb, out gid text, out g jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'No has iniciado sesión'; end if;
  select data into tok from public.tokens where id = tid;
  if tok is null then raise exception 'Personaje no encontrado'; end if;
  if tok->>'ownerId' is distinct from auth.uid()::text then raise exception 'Ese no es tu personaje'; end if;
  gid := tok->>'gameId';
  select data into g from public.games where id = gid for update;
  if g is null then raise exception 'Partida no encontrada'; end if;
  if coalesce((g#>>'{round,active}')::boolean, false) = false then raise exception 'El DM no ha abierto la ronda'; end if;
  if (g#>'{round,done}') ? tid then raise exception 'Ya has actuado en esta ronda'; end if;
end $$;

create or replace function public._round_done(gid text, tid text, action text)
returns void language sql security definer set search_path = public as $$
  update public.games
     set data = jsonb_set(
                  jsonb_set(data, '{round,done}', coalesce(data#>'{round,done}', '{}'::jsonb) || jsonb_build_object(tid, action)),
                  '{round,pending}', coalesce(data#>'{round,pending}', '{}'::jsonb) - tid)
   where id = gid;
$$;

create or replace function public._log_roll(gid text, who text, formula text, total int, detail text)
returns void language sql security definer set search_path = public as $$
  insert into public.rolls (id, data) values (gen_random_uuid()::text, jsonb_build_object(
    'ts', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'uid', auth.uid()::text, 'who', coalesce(who, 'Jugador'), 'gameId', gid,
    'formula', formula, 'total', total, 'detail', detail, 'priv', false));
$$;

create or replace function public._grid_of(map_id text) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(coalesce((select (data->>'grid')::numeric from public.maps where id = map_id), 70), 8);
$$;

-- 1) Movimiento: tirar el dado (una vez por ronda; repetir devuelve la misma tirada)
create or replace function public.round_move_roll(tid text) returns int
language plpgsql security definer set search_path = public as $$
declare tok jsonb; gid text; g jsonb; r int; die text;
begin
  select * into tok, gid, g from public._round_check(tid);
  if (g#>'{round,pending}') ? tid then return (g#>>array['round','pending',tid])::int; end if;
  die := coalesce(nullif(tok->>'moveDie',''), '1d6');
  r := greatest(public.roll_dice(die), 1);
  update public.games
     set data = jsonb_set(data, '{round,pending}', coalesce(data#>'{round,pending}', '{}'::jsonb) || jsonb_build_object(tid, r))
   where id = gid;
  perform public._log_roll(gid, tok->>'ownerName', 'Movimiento (' || die || ') · ' || coalesce(tok->>'name',''), r, r || ' casillas');
  return r;
end $$;

-- 2) Movimiento: confirmar destino (máximo las casillas sacadas)
create or replace function public.round_move_commit(tid text, nx numeric, ny numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare tok jsonb; gid text; g jsonb; r int; grid numeric; cells int; mw numeric; mh numeric;
begin
  select * into tok, gid, g from public._round_check(tid);
  if not ((g#>'{round,pending}') ? tid) then raise exception 'Tira primero el dado de movimiento'; end if;
  r := (g#>>array['round','pending',tid])::int;
  grid := public._grid_of(tok->>'mapId');
  cells := round(greatest(abs(nx - (tok->>'x')::numeric), abs(ny - (tok->>'y')::numeric)) / grid);
  if cells > r then raise exception 'Demasiado lejos: sacaste % y son % casillas', r, cells; end if;
  select coalesce((data->>'w')::numeric, 1e9), coalesce((data->>'h')::numeric, 1e9) into mw, mh from public.maps where id = tok->>'mapId';
  if nx < 0 or ny < 0 or nx > coalesce(mw, 1e9) or ny > coalesce(mh, 1e9) then raise exception 'Fuera del mapa'; end if;
  update public.tokens set data = data || jsonb_build_object('x', nx, 'y', ny) where id = tid;
  perform public._round_done(gid, tid, 'move');
  return true;
end $$;

-- 3) Combate: d20 + ataque contra la CA del enemigo; si impacta, daño de la clase
create or replace function public.round_attack(tid text, target text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tok jsonb; gid text; g jsonb; tg jsonb; grid numeric; dist int; rng int;
        d20 int; atk int; ac int; hit boolean; crit boolean; dmg int := 0; hp int; hpmax int; nhp int; det text;
begin
  select * into tok, gid, g from public._round_check(tid);
  select data into tg from public.tokens where id = target for update;
  if tg is null or tg->>'gameId' is distinct from gid or tg->>'mapId' is distinct from tok->>'mapId' then raise exception 'Objetivo no válido'; end if;
  if tg->>'type' is distinct from 'monster' then raise exception 'Solo puedes atacar a enemigos'; end if;
  if coalesce((tg->>'hidden')::boolean, false) then raise exception 'Objetivo no válido'; end if;
  grid := public._grid_of(tok->>'mapId');
  rng := greatest(coalesce((tok->>'range')::int, 1), 1);
  dist := round(greatest(abs((tg->>'x')::numeric - (tok->>'x')::numeric), abs((tg->>'y')::numeric - (tok->>'y')::numeric)) / grid);
  if dist > rng then raise exception 'Fuera de alcance: está a % casillas y tu alcance es %', dist, rng; end if;
  d20 := public.roll_dice('1d20');
  atk := coalesce((tok->>'atk')::int, 0);
  ac := coalesce((tg->>'ac')::int, 12);
  crit := d20 = 20;
  hit := crit or (d20 <> 1 and d20 + atk >= ac);
  hp := coalesce((tg->>'hp')::int, 0);
  hpmax := coalesce((tg->>'hpMax')::int, 0);
  nhp := hp;
  if hit then
    dmg := greatest(public.roll_dice(coalesce(nullif(tok->>'dmg',''), '1d6')), 1);
    if crit then dmg := dmg + greatest(public.roll_dice(coalesce(nullif(tok->>'dmg',''), '1d6')), 1); end if;
    nhp := greatest(hp - dmg, 0);
    update public.tokens set data = data || jsonb_build_object('hp', nhp) where id = target;
  end if;
  det := '[' || d20 || '] ' || case when atk >= 0 then '+' else '' end || atk || ' vs CA ' || ac || ' → ' ||
         case when crit then '¡CRÍTICO! ' || dmg || ' de daño'
              when hit then 'IMPACTO, ' || dmg || ' de daño'
              when d20 = 1 then 'pifia' else 'fallo' end ||
         case when hit then ' (' || coalesce(tg->>'name','') || ' ' || nhp || '/' || hpmax || ')' else '' end;
  perform public._log_roll(gid, tok->>'ownerName', '⚔ ' || coalesce(tok->>'name','') || ' ataca a ' || coalesce(tg->>'name',''), d20 + atk, det);
  perform public._round_done(gid, tid, 'attack');
  return jsonb_build_object('hit', hit, 'crit', crit, 'd20', d20, 'atk', atk, 'ac', ac, 'dmg', dmg, 'hp', nhp, 'hpMax', hpmax, 'target', tg->>'name');
end $$;

-- 4) Pasar turno
create or replace function public.round_pass(tid text) returns boolean
language plpgsql security definer set search_path = public as $$
declare tok jsonb; gid text; g jsonb;
begin
  select * into tok, gid, g from public._round_check(tid);
  perform public._round_done(gid, tid, 'pass');
  return true;
end $$;

-- Inventario: usar (consumibles bajan cantidad) y tirar
create or replace function public.inv_use(tid text, iid text) returns boolean
language plpgsql security definer set search_path = public as $$
declare tok jsonb; it jsonb; q int;
begin
  select data into tok from public.tokens where id = tid and data->>'ownerId' = auth.uid()::text for update;
  if tok is null then raise exception 'Ese no es tu personaje'; end if;
  select e into it from jsonb_array_elements(coalesce(tok#>'{inventory,items}', '[]'::jsonb)) e where e->>'id' = iid;
  if it is null then raise exception 'Objeto no encontrado'; end if;
  if coalesce((it->>'consumable')::boolean, false) then
    q := coalesce((it->>'qty')::int, 1) - 1;
    update public.tokens set data = jsonb_set(data, '{inventory,items}', coalesce((
      select jsonb_agg(case when e->>'id' = iid then jsonb_set(e, '{qty}', to_jsonb(q)) else e end)
        from jsonb_array_elements(data#>'{inventory,items}') e
       where not (e->>'id' = iid and q <= 0)), '[]'::jsonb))
     where id = tid;
  end if;
  insert into public.rolls (id, data) values (gen_random_uuid()::text, jsonb_build_object(
    'ts', (extract(epoch from clock_timestamp()) * 1000)::bigint, 'uid', auth.uid()::text,
    'who', coalesce(tok->>'ownerName','Jugador'), 'gameId', tok->>'gameId',
    'msg', '🎒 ' || coalesce(tok->>'name','') || ' usa ' || coalesce(it->>'name','un objeto')));
  return true;
end $$;

create or replace function public.inv_drop(tid text, iid text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.tokens set data = jsonb_set(data, '{inventory,items}', coalesce((
    select jsonb_agg(e) from jsonb_array_elements(coalesce(data#>'{inventory,items}', '[]'::jsonb)) e where e->>'id' <> iid), '[]'::jsonb))
   where id = tid and data->>'ownerId' = auth.uid()::text;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Permisos: solo las funciones públicas, solo usuarios con sesión
revoke all on function public.roll_dice(text) from public, anon, authenticated;
revoke all on function public._round_check(text) from public, anon, authenticated;
revoke all on function public._round_done(text, text, text) from public, anon, authenticated;
revoke all on function public._log_roll(text, text, text, int, text) from public, anon, authenticated;
revoke all on function public._grid_of(text) from public, anon, authenticated;
revoke all on function public.round_move_roll(text) from public;
revoke all on function public.round_move_commit(text, numeric, numeric) from public;
revoke all on function public.round_attack(text, text) from public;
revoke all on function public.round_pass(text) from public;
revoke all on function public.inv_use(text, text) from public;
revoke all on function public.inv_drop(text, text) from public;
grant execute on function public.round_move_roll(text) to authenticated;
grant execute on function public.round_move_commit(text, numeric, numeric) to authenticated;
grant execute on function public.round_attack(text, text) to authenticated;
grant execute on function public.round_pass(text) to authenticated;
grant execute on function public.inv_use(text, text) to authenticated;
grant execute on function public.inv_drop(text, text) to authenticated;
