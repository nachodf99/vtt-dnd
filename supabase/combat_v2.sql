-- ============================================================
-- Mesa de Rol — VTT · Combate v2
-- Ataques por clase desbloqueables por nivel, experiencia y subida de nivel,
-- muerte de monstruos y monstruos defensivos (contraataque / zona).
-- Requiere supabase/rounds.sql. Re-ejecutable.
-- ============================================================

-- Catálogo de ataques (lectura pública)
create table if not exists public.attacks (
  id text primary key, cls text not null, name text not null, lvl int not null default 1,
  range int not null default 1, dmg text not null, atk_bonus int not null default 0, descr text
);
alter table public.attacks enable row level security;
drop policy if exists attacks_select on public.attacks;
create policy attacks_select on public.attacks for select using (true);

insert into public.attacks (id, cls, name, lvl, range, dmg, atk_bonus, descr) values
 ('guerrero-espada',      'guerrero',  'Espada larga',           1, 1, '1d8+3',      0, 'Un tajo sólido y fiable.'),
 ('guerrero-arco',        'guerrero',  'Arco largo',             1, 8, '1d8+1',      0, 'Disparo a distancia.'),
 ('guerrero-poderoso',    'guerrero',  'Ataque poderoso',        3, 1, '2d8+3',     -1, 'Más daño a costa de precisión.'),
 ('guerrero-subita',      'guerrero',  'Acción súbita',          5, 1, '2d8+6',      0, 'Dos golpes encadenados.'),
 ('guerrero-devastador',  'guerrero',  'Golpe devastador',       8, 1, '3d8+6',      1, 'El golpe de un veterano.'),
 ('barbaro-hacha',        'barbaro',   'Gran hacha',             1, 1, '1d12+3',     0, 'Golpe brutal a dos manos.'),
 ('barbaro-jabalina',     'barbaro',   'Jabalina',               1, 4, '1d6+3',      0, 'Lanzada a media distancia.'),
 ('barbaro-temerario',    'barbaro',   'Ataque temerario',       3, 1, '2d12+3',     2, 'Ataca sin pensar en defenderse.'),
 ('barbaro-brutal',       'barbaro',   'Golpe brutal',           5, 1, '2d12+6',     1, 'La furia toma el control.'),
 ('barbaro-implacable',   'barbaro',   'Furia implacable',       8, 1, '3d12+6',     2, 'Nada le detiene.'),
 ('paladin-espada',       'paladin',   'Espada larga',           1, 1, '1d8+3',      0, 'Acero bendecido.'),
 ('paladin-castigo',      'paladin',   'Castigo divino',         2, 1, '3d8+3',      0, 'Luz sagrada en cada golpe.'),
 ('paladin-sagrado',      'paladin',   'Golpe sagrado',          5, 1, '4d8+3',      1, 'El juramento se hace carne.'),
 ('paladin-aura',         'paladin',   'Aura de luz',            8, 3, '3d8+5',      1, 'Un estallido de luz radiante.'),
 ('monje-punetazo',       'monje',     'Puñetazo',               1, 1, '1d6+3',      0, 'Artes marciales.'),
 ('monje-dardo',          'monje',     'Dardo',                  1, 4, '1d4+3',      0, 'Lanzamiento preciso.'),
 ('monje-rafaga',         'monje',     'Ráfaga de golpes',       2, 1, '2d6+3',      0, 'Una lluvia de puñetazos.'),
 ('monje-aturdidor',      'monje',     'Golpe aturdidor',        5, 1, '3d6+4',      1, 'Bloquea el ki del enemigo.'),
 ('monje-palma',          'monje',     'Palma temblorosa',       8, 1, '6d6+3',      1, 'Vibraciones letales.'),
 ('picaro-daga',          'picaro',    'Daga',                   1, 1, '1d4+3',      0, 'Rápida y silenciosa.'),
 ('picaro-arco',          'picaro',    'Arco corto',             1, 6, '1d6+3',      0, 'Desde las sombras.'),
 ('picaro-furtivo',       'picaro',    'Ataque furtivo',         3, 6, '3d6+3',      0, 'Donde más duele.'),
 ('picaro-letal',         'picaro',    'Golpe letal',            5, 1, '4d6+3',      1, 'Busca un punto vital.'),
 ('picaro-asesinato',     'picaro',    'Asesinato',              8, 6, '6d6+3',      2, 'Ni lo ven venir.'),
 ('explorador-arco',      'explorador','Arco largo',             1, 8, '1d8+3',      0, 'El arma del cazador.'),
 ('explorador-espadas',   'explorador','Espadas cortas',         1, 1, '1d6+3',      0, 'Dos hojas a la vez.'),
 ('explorador-marca',     'explorador','Marca del cazador',      2, 8, '2d8+3',      0, 'La presa ya está marcada.'),
 ('explorador-andanada',  'explorador','Andanada',               5, 8, '3d8+3',      0, 'Una lluvia de flechas.'),
 ('explorador-certero',   'explorador','Disparo certero',        8,10, '4d8+4',      2, 'No falla.'),
 ('clerigo-maza',         'clerigo',   'Maza',                   1, 1, '1d6+2',      0, 'Fe contundente.'),
 ('clerigo-llama',        'clerigo',   'Llama sagrada',          1, 4, '1d8',        0, 'Fuego divino desde arriba.'),
 ('clerigo-arma',         'clerigo',   'Arma espiritual',        3, 4, '1d8+3',      0, 'Un arma etérea combate por ti.'),
 ('clerigo-guardianes',   'clerigo',   'Guardianes espirituales',5, 2, '3d8',        0, 'Espíritus protectores.'),
 ('clerigo-divino',       'clerigo',   'Golpe divino',           8, 1, '2d6+2d8+3',  1, 'La ira de los dioses.'),
 ('druida-baston',        'druida',    'Bastón',                 1, 1, '1d6',        0, 'Madera viva.'),
 ('druida-espinas',       'druida',    'Látigo de espinas',      1, 3, '1d6+2',      0, 'Zarzas que atrapan.'),
 ('druida-rayo-lunar',    'druida',    'Rayo lunar',             3, 6, '2d10',       0, 'Luz de luna abrasadora.'),
 ('druida-llamarada',     'druida',    'Llamarada',              5, 6, '3d10',       0, 'Columna de fuego.'),
 ('druida-tormenta',      'druida',    'Tormenta',               8, 8, '4d10',       1, 'Rayos del cielo.'),
 ('bardo-estoque',        'bardo',     'Estoque',                1, 1, '1d8+2',      0, 'Elegante y preciso.'),
 ('bardo-burla',          'bardo',     'Burla cruel',            1, 6, '1d4+2',      0, 'Palabras que hieren de verdad.'),
 ('bardo-onda',           'bardo',     'Onda atronadora',        3, 2, '2d8',        0, 'Un estruendo ensordecedor.'),
 ('bardo-sonica',         'bardo',     'Ráfaga sónica',          5, 6, '3d8',        0, 'La música como arma.'),
 ('bardo-palabra',        'bardo',     'Palabra de poder',       8, 6, '5d8',        1, 'Una sola palabra basta.'),
 ('brujo-explosion',      'brujo',     'Explosión sobrenatural', 1, 8, '1d10+3',     0, 'Energía de tu patrón.'),
 ('brujo-daga',           'brujo',     'Daga',                   1, 1, '1d4+2',      0, 'Para cuando se acercan.'),
 ('brujo-hambre',         'brujo',     'Hambre de Hadar',        3, 6, '4d6',        0, 'Oscuridad que devora.'),
 ('brujo-doble',          'brujo',     'Explosión doble',        5, 8, '2d10+6',     0, 'Dos rayos a la vez.'),
 ('brujo-muerte',         'brujo',     'Dedo de la muerte',      8, 6, '7d8',        1, 'Un pacto que cobra vidas.'),
 ('hechicero-fuego',      'hechicero', 'Rayo de fuego',          1, 8, '1d10',       0, 'Llamas desde tus manos.'),
 ('hechicero-proyectil',  'hechicero', 'Proyectil mágico',       1, 8, '3d4+3',      3, 'Dardos de fuerza casi infalibles.'),
 ('hechicero-abrasador',  'hechicero', 'Rayo abrasador',         3, 8, '3d6+2',      0, 'Tres rayos ardientes.'),
 ('hechicero-bola',       'hechicero', 'Bola de fuego',          5, 8, '6d6',        0, 'El clásico.'),
 ('hechicero-desintegrar','hechicero', 'Desintegrar',            8, 6, '8d6+10',     0, 'Polvo eres.'),
 ('mago-fuego',           'mago',      'Rayo de fuego',          1, 8, '1d10',       0, 'Truco ígneo.'),
 ('mago-proyectil',       'mago',      'Proyectil mágico',       1, 8, '3d4+3',      3, 'Dardos de fuerza casi infalibles.'),
 ('mago-abrasador',       'mago',      'Rayo abrasador',         3, 8, '3d6+2',      0, 'Tres rayos ardientes.'),
 ('mago-bola',            'mago',      'Bola de fuego',          5, 8, '6d6',        0, 'El clásico.'),
 ('mago-desintegrar',     'mago',      'Rayo desintegrador',     8, 6, '8d6+10',     0, 'Polvo eres.')
on conflict (id) do update set cls = excluded.cls, name = excluded.name, lvl = excluded.lvl, range = excluded.range,
  dmg = excluded.dmg, atk_bonus = excluded.atk_bonus, descr = excluded.descr;

-- Línea de visión entre dos puntos según los muros del mapa (puertas abiertas no bloquean)
create or replace function public._los(map_id text, ax numeric, ay numeric, bx numeric, by numeric) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m jsonb; w record; ox numeric; oy numeric; x1 numeric; y1 numeric; x2 numeric; y2 numeric; d numeric; t numeric; u numeric; ds jsonb;
begin
  select data into m from public.maps where id = map_id;
  if m is null then return true; end if;
  ox := coalesce((m->>'wallOffX')::numeric, 0); oy := coalesce((m->>'wallOffY')::numeric, 0);
  ds := coalesce(m->'doorStates', '{}'::jsonb);
  for w in select a.e, (a.ord - 1)::text as idx from jsonb_array_elements(coalesce(m->'walls', '[]'::jsonb)) with ordinality as a(e, ord) loop
    if coalesce((w.e->>'sight')::int, 1) = 0 then continue; end if;
    if coalesce((w.e->>'door')::int, 0) = 1 and coalesce((ds->>w.idx)::boolean, false) then continue; end if;
    x1 := (w.e->>'x1')::numeric + ox; y1 := (w.e->>'y1')::numeric + oy;
    x2 := (w.e->>'x2')::numeric + ox; y2 := (w.e->>'y2')::numeric + oy;
    d := (bx - ax) * (y2 - y1) - (by - ay) * (x2 - x1);
    if abs(d) < 1e-9 then continue; end if;
    t := ((x1 - ax) * (y2 - y1) - (y1 - ay) * (x2 - x1)) / d;
    u := ((x1 - ax) * (by - ay) - (y1 - ay) * (bx - ax)) / d;
    if t > 0.001 and t < 0.999 and u > -0.001 and u < 1.001 then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public._class_hp(cls text) returns int language sql immutable as $$
  select case cls when 'barbaro' then 7 when 'guerrero' then 6 when 'paladin' then 6 when 'explorador' then 6
                  when 'mago' then 4 when 'hechicero' then 4 else 5 end;
$$;

create or replace function public._level_for(xp int) returns int language sql immutable as $$
  select case when xp >= 4500 then 10 when xp >= 3600 then 9 when xp >= 2800 then 8 when xp >= 2100 then 7
              when xp >= 1500 then 6 when xp >= 1000 then 5 when xp >= 600 then 4 when xp >= 300 then 3
              when xp >= 100 then 2 else 1 end;
$$;

-- Registro de mensajes de monstruos (sin uid de jugador)
create or replace function public._log_npc(gid text, who text, formula text, total int, detail text)
returns void language sql security definer set search_path = public as $$
  insert into public.rolls (id, data) values (gen_random_uuid()::text, jsonb_build_object(
    'ts', (extract(epoch from clock_timestamp()) * 1000)::bigint, 'uid', 'npc', 'who', coalesce(who, 'Monstruo'),
    'gameId', gid, 'formula', formula, 'total', total, 'detail', detail, 'priv', false));
$$;

-- Dar experiencia y subir de nivel
create or replace function public._grant_xp(tid text, amount int, gid text) returns int
language plpgsql security definer set search_path = public as $$
declare t jsonb; oldl int; newl int; nxp int; gain int := 0; atkup int := 0; i int;
begin
  if amount is null or amount <= 0 then return null; end if;
  select data into t from public.tokens where id = tid for update;
  if t is null then return null; end if;
  nxp := coalesce((t->>'xp')::int, 0) + amount;
  oldl := greatest(coalesce((t->>'level')::int, public._level_for(coalesce((t->>'xp')::int, 0))), 1);
  newl := greatest(public._level_for(nxp), oldl);
  if newl > oldl then
    for i in (oldl + 1)..newl loop
      gain := gain + public._class_hp(t->>'cls');
      if i in (5, 9) then atkup := atkup + 1; end if;
    end loop;
  end if;
  update public.tokens set data = data || jsonb_build_object(
      'xp', nxp, 'level', newl,
      'hpMax', coalesce((t->>'hpMax')::int, 0) + gain,
      'hp', coalesce((t->>'hp')::int, 0) + gain,
      'atk', coalesce((t->>'atk')::int, 0) + atkup)
   where id = tid;
  if newl > oldl then
    perform public._log_npc(gid, '⭐ ' || coalesce(t->>'ownerName', 'Grupo'), '⬆ ' || coalesce(t->>'name','') || ' sube a nivel ' || newl, newl,
      '+' || gain || ' PV máx' || case when atkup > 0 then ', +' || atkup || ' al ataque' else '' end || ' · ¡nuevos ataques disponibles!');
  end if;
  return newl;
end $$;

-- Un monstruo ataca a un PJ (reacción defensiva)
create or replace function public._monster_strike(mid text, pid text, gid text, reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mo jsonb; pc jsonb; d20 int; atk int; ac int; hit boolean; crit boolean; dmg int := 0; nhp int; dmgx text;
begin
  select data into mo from public.tokens where id = mid;
  select data into pc from public.tokens where id = pid for update;
  if mo is null or pc is null then return null; end if;
  d20 := public.roll_dice('1d20');
  atk := coalesce((mo->>'atk')::int, 3);
  ac := coalesce((pc->>'ac')::int, 10);
  crit := d20 = 20;
  hit := crit or (d20 <> 1 and d20 + atk >= ac);
  nhp := coalesce((pc->>'hp')::int, 0);
  dmgx := coalesce(nullif(mo->>'dmg', ''), '1d6+1');
  if hit then
    dmg := greatest(public.roll_dice(dmgx), 1);
    if crit then dmg := dmg + greatest(public.roll_dice(dmgx), 1); end if;
    nhp := greatest(nhp - dmg, 0);
    update public.tokens set data = data || jsonb_build_object('hp', nhp) where id = pid;
  end if;
  perform public._log_npc(gid, '👹 ' || coalesce(mo->>'name', 'Monstruo'),
    '🛡 ' || coalesce(mo->>'name','') || ' responde a ' || coalesce(pc->>'name','') || ' (' || reason || ')', d20 + atk,
    '[' || d20 || '] +' || atk || ' vs CA ' || ac || ' → ' ||
    case when crit then '¡CRÍTICO! ' || dmg || ' de daño' when hit then 'IMPACTO, ' || dmg || ' de daño'
         when d20 = 1 then 'pifia' else 'fallo' end ||
    case when hit then ' (' || coalesce(pc->>'name','') || ' ' || nhp || '/' || coalesce(pc->>'hpMax','?') || ')' ||
         case when nhp = 0 then ' 💀 ¡inconsciente!' else '' end else '' end);
  return jsonb_build_object('monster', mo->>'name', 'hit', hit, 'crit', crit, 'd20', d20, 'atk', atk, 'ac', ac,
                            'dmg', dmg, 'hp', nhp, 'hpMax', (pc->>'hpMax')::int, 'reason', reason);
end $$;

-- Monstruos visibles que tienen al PJ a su alcance y en línea de visión reaccionan
create or replace function public._monster_reactions(pid text, gid text, reason text, skip_mid text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pc jsonb; mo record; grid numeric; dist int; res jsonb := '[]'::jsonb; r jsonb;
begin
  select data into pc from public.tokens where id = pid;
  if pc is null then return res; end if;
  grid := public._grid_of(pc->>'mapId');
  for mo in select id, data from public.tokens
             where data->>'gameId' = gid and data->>'mapId' = pc->>'mapId' and data->>'type' = 'monster'
               and not coalesce((data->>'hidden')::boolean, false) and coalesce((data->>'hp')::int, 1) > 0
               and id is distinct from skip_mid loop
    dist := round(greatest(abs((mo.data->>'x')::numeric - (pc->>'x')::numeric), abs((mo.data->>'y')::numeric - (pc->>'y')::numeric)) / grid);
    if dist <= greatest(coalesce((mo.data->>'range')::int, 1), 1)
       and public._los(pc->>'mapId', (mo.data->>'x')::numeric, (mo.data->>'y')::numeric, (pc->>'x')::numeric, (pc->>'y')::numeric) then
      r := public._monster_strike(mo.id, pid, gid, reason);
      if r is not null then res := res || jsonb_build_array(r); end if;
      select data into pc from public.tokens where id = pid;
      exit when coalesce((pc->>'hp')::int, 0) <= 0;
    end if;
  end loop;
  return res;
end $$;

-- Comprobación de ronda: además, un PJ inconsciente no puede actuar
create or replace function public._round_check(tid text, out tok jsonb, out gid text, out g jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'No has iniciado sesión'; end if;
  select data into tok from public.tokens where id = tid;
  if tok is null then raise exception 'Personaje no encontrado'; end if;
  if tok->>'ownerId' is distinct from auth.uid()::text then raise exception 'Ese no es tu personaje'; end if;
  if coalesce((tok->>'hpMax')::int, 0) > 0 and coalesce((tok->>'hp')::int, 0) <= 0 then raise exception 'Estás inconsciente: no puedes actuar'; end if;
  gid := tok->>'gameId';
  select data into g from public.games where id = gid for update;
  if g is null then raise exception 'Partida no encontrada'; end if;
  if coalesce((g#>>'{round,active}')::boolean, false) = false then raise exception 'El DM no ha abierto la ronda'; end if;
  if (g#>'{round,done}') ? tid then raise exception 'Ya has actuado en esta ronda'; end if;
end $$;

-- Mover: ahora devuelve las reacciones de los monstruos
drop function if exists public.round_move_commit(text, numeric, numeric);
create function public.round_move_commit(tid text, nx numeric, ny numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tok jsonb; gid text; g jsonb; r int; grid numeric; cells int; mw numeric; mh numeric; reac jsonb;
begin
  select * into tok, gid, g from public._round_check(tid);
  if not ((g#>'{round,pending}') ? tid) then raise exception 'Tira primero el dado de movimiento'; end if;
  r := (g#>>array['round','pending',tid])::int;
  grid := public._grid_of(tok->>'mapId');
  cells := round(greatest(abs(nx - (tok->>'x')::numeric), abs(ny - (tok->>'y')::numeric)) / grid);
  if cells > r then raise exception 'Demasiado lejos: sacaste % y son % casillas', r, cells; end if;
  select coalesce((data->>'w')::numeric, 1e9), coalesce((data->>'h')::numeric, 1e9) into mw, mh from public.maps where id = tok->>'mapId';
  if nx < 0 or ny < 0 or nx > coalesce(mw, 1e9) or ny > coalesce(mh, 1e9) then raise exception 'Fuera del mapa'; end if;
  if not public._los(tok->>'mapId', (tok->>'x')::numeric, (tok->>'y')::numeric, nx, ny) then raise exception 'Hay un muro en medio'; end if;
  update public.tokens set data = data || jsonb_build_object('x', nx, 'y', ny) where id = tid;
  perform public._round_done(gid, tid, 'move');
  reac := public._monster_reactions(tid, gid, 'te ve entrar en su zona');
  return jsonb_build_object('ok', true, 'reactions', reac);
end $$;

-- Atacar con un ataque de tu clase (o el básico del token)
drop function if exists public.round_attack(text, text);
drop function if exists public.round_attack(text, text, text);
create function public.round_attack(tid text, target text, attack_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tok jsonb; gid text; g jsonb; tg jsonb; a public.attacks%rowtype; grid numeric; dist int; rng int; lvl int;
        aname text; dmgx text; bonus int := 0;
        d20 int; atk int; ac int; hit boolean; crit boolean; dmg int := 0; hp int; hpmax int; nhp int; det text;
        dead boolean := false; mxp int; party record; nparty int; share int := 0; xpgain int; counter jsonb := null;
begin
  select * into tok, gid, g from public._round_check(tid);
  select data into tg from public.tokens where id = target for update;
  if tg is null or tg->>'gameId' is distinct from gid or tg->>'mapId' is distinct from tok->>'mapId' then raise exception 'Objetivo no válido'; end if;
  if tg->>'type' is distinct from 'monster' then raise exception 'Solo puedes atacar a enemigos'; end if;
  if coalesce((tg->>'hidden')::boolean, false) then raise exception 'Objetivo no válido'; end if;
  lvl := greatest(coalesce((tok->>'level')::int, 1), 1);
  if attack_id is null or attack_id = 'basic' then
    aname := 'Ataque básico'; rng := greatest(coalesce((tok->>'range')::int, 1), 1); dmgx := coalesce(nullif(tok->>'dmg', ''), '1d6');
  else
    select * into a from public.attacks where id = attack_id;
    if not found or a.cls is distinct from tok->>'cls' then raise exception 'Ese ataque no es de tu clase'; end if;
    if a.lvl > lvl then raise exception '% se desbloquea a nivel %', a.name, a.lvl; end if;
    aname := a.name; rng := greatest(a.range, 1); dmgx := a.dmg; bonus := a.atk_bonus;
  end if;
  grid := public._grid_of(tok->>'mapId');
  dist := round(greatest(abs((tg->>'x')::numeric - (tok->>'x')::numeric), abs((tg->>'y')::numeric - (tok->>'y')::numeric)) / grid);
  if dist > rng then raise exception 'Fuera de alcance: está a % casillas y % llega a %', dist, aname, rng; end if;
  if not public._los(tok->>'mapId', (tok->>'x')::numeric, (tok->>'y')::numeric, (tg->>'x')::numeric, (tg->>'y')::numeric) then
    raise exception 'No tienes línea de visión con %', tg->>'name'; end if;
  d20 := public.roll_dice('1d20');
  atk := coalesce((tok->>'atk')::int, 0) + bonus;
  ac := coalesce((tg->>'ac')::int, 12);
  crit := d20 = 20;
  hit := crit or (d20 <> 1 and d20 + atk >= ac);
  hp := coalesce((tg->>'hp')::int, 0);
  hpmax := coalesce((tg->>'hpMax')::int, 0);
  nhp := hp;
  if hit then
    dmg := greatest(public.roll_dice(dmgx), 1);
    if crit then dmg := dmg + greatest(public.roll_dice(dmgx), 1); end if;
    nhp := greatest(hp - dmg, 0);
  end if;
  det := '[' || d20 || '] ' || case when atk >= 0 then '+' else '' end || atk || ' vs CA ' || ac || ' → ' ||
         case when crit then '¡CRÍTICO! ' || dmg || ' de daño' when hit then 'IMPACTO, ' || dmg || ' de daño'
              when d20 = 1 then 'pifia' else 'fallo' end ||
         case when hit and nhp > 0 then ' (' || coalesce(tg->>'name','') || ' ' || nhp || '/' || hpmax || ')' else '' end;
  perform public._log_roll(gid, tok->>'ownerName', '⚔ ' || coalesce(tok->>'name','') || ' · ' || aname || ' contra ' || coalesce(tg->>'name',''), d20 + atk, det);
  perform public._round_done(gid, tid, 'attack');

  if hit and nhp = 0 then
    -- Muere: desaparece y su experiencia se reparte entre el grupo
    dead := true;
    delete from public.tokens where id = target;
    mxp := coalesce((tg->>'xp')::int, greatest(20, hpmax * 5));
    select count(*) into nparty from public.tokens
     where data->>'gameId' = gid and data->>'mapId' = tok->>'mapId' and data->>'type' = 'pc' and coalesce(data->>'ownerId', '') <> '';
    nparty := greatest(nparty, 1);
    share := ceil(mxp::numeric / nparty);
    perform public._log_npc(gid, '💀', '💀 ' || coalesce(tg->>'name','') || ' ha muerto', mxp, '+' || share || ' XP para cada miembro del grupo (' || mxp || ' XP en total)');
    for party in select id from public.tokens
                  where data->>'gameId' = gid and data->>'mapId' = tok->>'mapId' and data->>'type' = 'pc' and coalesce(data->>'ownerId', '') <> '' loop
      perform public._grant_xp(party.id, share, gid);
    end loop;
  else
    update public.tokens set data = data || jsonb_build_object('hp', nhp) where id = target;
  end if;

  xpgain := case when hit then 10 else 2 end;
  perform public._grant_xp(tid, xpgain, gid);

  -- Contraataque si sigue vivo y el PJ está a su alcance y a la vista
  if not dead and dist <= greatest(coalesce((tg->>'range')::int, 1), 1)
     and public._los(tok->>'mapId', (tg->>'x')::numeric, (tg->>'y')::numeric, (tok->>'x')::numeric, (tok->>'y')::numeric) then
    counter := public._monster_strike(target, tid, gid, 'contraataque');
  end if;

  return jsonb_build_object('attack', aname, 'hit', hit, 'crit', crit, 'd20', d20, 'atk', atk, 'ac', ac, 'dmg', dmg,
    'hp', nhp, 'hpMax', hpmax, 'target', tg->>'name', 'dead', dead, 'xp', xpgain + share,
    'counter', counter);
end $$;

-- Permisos
revoke all on function public._los(text, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public._class_hp(text) from public, anon, authenticated;
revoke all on function public._level_for(int) from public, anon, authenticated;
revoke all on function public._log_npc(text, text, text, int, text) from public, anon, authenticated;
revoke all on function public._grant_xp(text, int, text) from public, anon, authenticated;
revoke all on function public._monster_strike(text, text, text, text) from public, anon, authenticated;
revoke all on function public._monster_reactions(text, text, text, text) from public, anon, authenticated;
revoke all on function public._round_check(text) from public, anon, authenticated;
revoke all on function public.round_move_commit(text, numeric, numeric) from public;
revoke all on function public.round_attack(text, text, text) from public;
grant execute on function public.round_move_commit(text, numeric, numeric) to authenticated;
grant execute on function public.round_attack(text, text, text) to authenticated;
