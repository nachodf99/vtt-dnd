-- ============================================================
-- Mesa de Rol — VTT · Equipo y características (reglas 2024)
-- Requiere rounds.sql, combat_v2.sql, items.sql, effects.sql y equipment_items.sql.
-- Re-ejecutable (sin DROP).
-- ============================================================

-- Características por defecto según la clase (distribución estándar 15/14/13/12/10/8)
create or replace function public._class_abil(cls text) returns jsonb language sql immutable as $$
  select case cls
    when 'guerrero'   then '{"str":15,"dex":13,"con":14,"int":8,"wis":12,"cha":10}'
    when 'barbaro'    then '{"str":15,"dex":13,"con":14,"int":8,"wis":12,"cha":10}'
    when 'paladin'    then '{"str":15,"dex":10,"con":13,"int":8,"wis":12,"cha":14}'
    when 'monje'      then '{"str":12,"dex":15,"con":13,"int":10,"wis":14,"cha":8}'
    when 'picaro'     then '{"str":8,"dex":15,"con":13,"int":14,"wis":12,"cha":10}'
    when 'explorador' then '{"str":12,"dex":15,"con":13,"int":8,"wis":14,"cha":10}'
    when 'clerigo'    then '{"str":13,"dex":12,"con":14,"int":8,"wis":15,"cha":10}'
    when 'druida'     then '{"str":8,"dex":13,"con":14,"int":12,"wis":15,"cha":10}'
    when 'bardo'      then '{"str":8,"dex":14,"con":13,"int":12,"wis":10,"cha":15}'
    when 'brujo'      then '{"str":8,"dex":14,"con":13,"int":12,"wis":10,"cha":15}'
    when 'hechicero'  then '{"str":8,"dex":13,"con":14,"int":10,"wis":12,"cha":15}'
    when 'mago'       then '{"str":8,"dex":13,"con":14,"int":15,"wis":12,"cha":10}'
    else '{}' end::jsonb;
$$;

-- Recalcula CA, arma y características efectivas de un PJ a partir de su equipo puesto
create or replace function public._recalc(tid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t jsonb; ab jsonb; eff jsonb; it record; eq jsonb; armor jsonb; shield jsonb; weapon jsonb; accs jsonb := '[]'::jsonb; a jsonb;
        k text; v int; lvl int; pb int; strm int; dexm int; conm int; wism int;
        ac int; parts text; base int; dexpart int; watk int := 0; wdmg int := 0; wextra text := ''; bonus int; amod int; m int;
        wpn jsonb; dmgstr text; abname text; attuned int := 0; warn text := null;
begin
  select data into t from public.tokens where id = tid for update;
  if t is null or t->>'type' is distinct from 'pc' then return null; end if;
  ab := '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}'::jsonb || coalesce(t->'abil', public._class_abil(t->>'cls'));
  eff := ab;
  for it in select e as inv, i.eq as eq
              from jsonb_array_elements(coalesce(t#>'{inventory,items}', '[]'::jsonb)) e
              join public.items i on i.id = e->>'itemId'
             where coalesce((e->>'equipped')::boolean, false) and i.eq is not null loop
    eq := it.eq || jsonb_build_object('name', it.inv->>'name');
    if coalesce((eq->>'attune')::boolean, false) then attuned := attuned + 1; end if;
    if eq->>'slot' = 'armor' then armor := eq;
    elsif eq->>'slot' = 'shield' then shield := eq;
    elsif eq->>'slot' = 'weapon' then weapon := eq;
    else accs := accs || jsonb_build_array(eq); end if;
    if eq ? 'set' then
      for k, v in select key, value::int from jsonb_each_text(eq->'set') loop
        if coalesce((eff->>k)::int, 10) < v then eff := eff || jsonb_build_object(k, v); end if;
      end loop;
    end if;
  end loop;

  strm := floor(((eff->>'str')::int - 10) / 2.0); dexm := floor(((eff->>'dex')::int - 10) / 2.0);
  conm := floor(((eff->>'con')::int - 10) / 2.0); wism := floor(((eff->>'wis')::int - 10) / 2.0);
  lvl := greatest(coalesce((t->>'level')::int, 1), 1);
  pb := 2 + (lvl - 1) / 4;

  -- Clase de armadura
  if armor is not null then
    base := (armor->>'ac')::int;
    dexpart := case armor->>'dex' when 'full' then dexm when 'max2' then least(dexm, 2) else 0 end;
    parts := (armor->>'name') || ' ' || base || case when dexpart <> 0 then ' ' || case when dexpart > 0 then '+' else '' end || dexpart || ' Des' else '' end;
    if coalesce((armor->>'str')::int, 0) > (eff->>'str')::int then warn := 'Fuerza ' || (armor->>'str') || ' requerida: velocidad −10 pies'; end if;
  elsif t->>'cls' = 'barbaro' then
    base := 10; dexpart := dexm + conm; parts := 'Defensa sin armadura 10 ' || case when dexm >= 0 then '+' else '' end || dexm || ' Des ' || case when conm >= 0 then '+' else '' end || conm || ' Con';
  elsif t->>'cls' = 'monje' and shield is null then
    base := 10; dexpart := dexm + wism; parts := 'Defensa sin armadura 10 ' || case when dexm >= 0 then '+' else '' end || dexm || ' Des ' || case when wism >= 0 then '+' else '' end || wism || ' Sab';
  else
    base := 10; dexpart := dexm; parts := 'Sin armadura 10' || case when dexm <> 0 then ' ' || case when dexm > 0 then '+' else '' end || dexm || ' Des' else '' end;
  end if;
  ac := base + dexpart;
  if shield is not null then ac := ac + (shield->>'ac')::int; parts := parts || ' · ' || (shield->>'name') || ' +' || (shield->>'ac'); end if;
  for a in select x from jsonb_array_elements(accs) x loop
    if coalesce((a->>'ac')::int, 0) <> 0
       and not (coalesce((a->>'needArmor')::boolean, false) and armor is null)
       and not (coalesce((a->>'needShield')::boolean, false) and shield is null)
       and not (coalesce((a->>'noArmor')::boolean, false) and armor is not null)
       and not (coalesce((a->>'noShield')::boolean, false) and shield is not null) then
      ac := ac + (a->>'ac')::int; parts := parts || ' · ' || (a->>'name') || ' +' || (a->>'ac');
    end if;
    watk := watk + coalesce((a->>'watk')::int, 0);
    wdmg := wdmg + coalesce((a->>'wdmg')::int, 0);
    if coalesce(a->>'wextra', '') <> '' then wextra := wextra || '+' || (a->>'wextra'); end if;
  end loop;
  if coalesce((t->>'acMisc')::int, 0) <> 0 then
    ac := ac + (t->>'acMisc')::int; parts := parts || ' · ajuste ' || case when (t->>'acMisc')::int > 0 then '+' else '' end || (t->>'acMisc');
  end if;

  -- Arma (o golpe sin armas)
  if weapon is not null then
    if coalesce((weapon->>'ranged')::boolean, false) then amod := dexm; abname := 'Des';
    elsif coalesce((weapon->>'finesse')::boolean, false) and dexm > strm then amod := dexm; abname := 'Des';
    else amod := strm; abname := 'Fue'; end if;
    bonus := coalesce((weapon->>'bonus')::int, 0) + watk;
    m := amod + coalesce((weapon->>'bonus')::int, 0) + wdmg;
    dmgstr := (weapon->>'dice') || case when m > 0 then '+' || m when m < 0 then m::text else '' end || wextra;
    wpn := jsonb_build_object('name', weapon->>'name', 'dmg', dmgstr, 'atk', pb + amod + bonus, 'range', greatest(coalesce((weapon->>'range')::int, 1), 1),
                              'dtype', coalesce(weapon->>'dtype', ''), 'abil', abname, 'twoh', coalesce((weapon->>'twoh')::boolean, false));
  else
    wpn := jsonb_build_object('name', 'Golpe sin armas', 'dmg', greatest(1 + strm, 1)::text, 'atk', pb + strm, 'range', 1, 'dtype', 'contundente', 'abil', 'Fue', 'twoh', false);
  end if;

  update public.tokens set data = data || jsonb_build_object(
      'ac', ac, 'acParts', parts, 'wpn', wpn, 'abilEff', eff, 'pb', pb, 'attuned', attuned, 'eqWarn', warn)
   where id = tid;
  return jsonb_build_object('ac', ac, 'acParts', parts, 'wpn', wpn, 'abilEff', eff, 'pb', pb, 'attuned', attuned, 'warn', warn);
end $$;

-- El DM (o el dueño) pide recalcular tras editar la ficha
create or replace function public.token_recalc(tid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t jsonb;
begin
  select data into t from public.tokens where id = tid;
  if t is null then raise exception 'Token no encontrado'; end if;
  if not (public.is_game_dm(t->>'gameId') or t->>'ownerId' = auth.uid()::text) then raise exception 'Sin permiso'; end if;
  return public._recalc(tid);
end $$;

-- Equipar / quitar un objeto (persistente). Un arma, una armadura y un escudo a la vez;
-- arma a dos manos incompatible con escudo; máximo 3 objetos sintonizados.
create or replace function public.item_equip(tid text, iid text, on_ boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t jsonb; it jsonb; eq jsonb; slot text; n int; items jsonb; res jsonb; nm text;
begin
  select data into t from public.tokens where id = tid for update;
  if t is null then raise exception 'Token no encontrado'; end if;
  if not (t->>'ownerId' = auth.uid()::text or public.is_game_dm(t->>'gameId')) then raise exception 'Ese no es tu personaje'; end if;
  select e into it from jsonb_array_elements(coalesce(t#>'{inventory,items}', '[]'::jsonb)) e where e->>'id' = iid;
  if it is null then raise exception 'Objeto no encontrado'; end if;
  select i.eq into eq from public.items i where i.id = it->>'itemId';
  if eq is null then raise exception '% no se puede equipar', coalesce(it->>'name', 'Ese objeto'); end if;
  slot := coalesce(eq->>'slot', 'acc');
  nm := coalesce(it->>'name', 'objeto');
  items := coalesce(t#>'{inventory,items}', '[]'::jsonb);

  if on_ then
    if coalesce((eq->>'attune')::boolean, false) then
      select count(*) into n from jsonb_array_elements(items) e join public.items i on i.id = e->>'itemId'
       where coalesce((e->>'equipped')::boolean, false) and coalesce((i.eq->>'attune')::boolean, false) and e->>'id' <> iid;
      if n >= 3 then raise exception 'Ya tienes 3 objetos sintonizados: quítate uno antes'; end if;
    end if;
    if slot = 'shield' and exists (select 1 from jsonb_array_elements(items) e join public.items i on i.id = e->>'itemId'
                                    where coalesce((e->>'equipped')::boolean, false) and i.eq->>'slot' = 'weapon' and coalesce((i.eq->>'twoh')::boolean, false)) then
      raise exception 'Tu arma es a dos manos: no puedes llevar escudo';
    end if;
    if slot = 'weapon' and coalesce((eq->>'twoh')::boolean, false) and exists (select 1 from jsonb_array_elements(items) e join public.items i on i.id = e->>'itemId'
                                    where coalesce((e->>'equipped')::boolean, false) and i.eq->>'slot' = 'shield') then
      raise exception '% es a dos manos: quítate el escudo primero', nm;
    end if;
    -- Equipa este y quita el anterior del mismo hueco (arma, armadura o escudo)
    select coalesce(jsonb_agg(case
             when e->>'id' = iid then e || '{"equipped": true}'::jsonb
             when slot in ('armor', 'shield', 'weapon') and i.eq->>'slot' = slot then e || '{"equipped": false}'::jsonb
             else e end order by ord), '[]'::jsonb)
      into items
      from jsonb_array_elements(items) with ordinality as x(e, ord) left join public.items i on i.id = e->>'itemId';
  else
    select coalesce(jsonb_agg(case when e->>'id' = iid then e || '{"equipped": false}'::jsonb else e end order by ord), '[]'::jsonb)
      into items from jsonb_array_elements(items) with ordinality as x(e, ord);
  end if;

  update public.tokens set data = jsonb_set(data, '{inventory,items}', items) where id = tid;
  res := public._recalc(tid);
  insert into public.rolls (id, data) values (gen_random_uuid()::text, jsonb_build_object(
    'ts', (extract(epoch from clock_timestamp()) * 1000)::bigint, 'uid', auth.uid()::text,
    'who', coalesce(t->>'ownerName', 'Jugador'), 'gameId', t->>'gameId',
    'msg', case when on_ then '🛡 ' else '🎒 ' end || coalesce(t->>'name', '') || case when on_ then ' se equipa ' else ' se quita ' end || nm ||
           ' · CA ' || (res->>'ac')));
  return res;
end $$;

-- Subir de nivel recalcula (cambia el bonificador de competencia)
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
    perform public._recalc(tid);
  end if;
  return newl;
end $$;

-- Atacar: añade el ataque con el arma equipada (attack_id = 'weapon')
create or replace function public.round_attack(tid text, target text, attack_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tok jsonb; gid text; g jsonb; tg jsonb; a public.attacks%rowtype; grid numeric; dist int; rng int; lvl int;
        aname text; dmgx text; bonus int := 0;
        d20 int; atk int; ac int; hit boolean; crit boolean; dmg int := 0; hp int; hpmax int; nhp int; det text;
        dead boolean := false; share int := 0; xpgain int; counter jsonb := null;
begin
  select * into tok, gid, g from public._round_check(tid);
  select data into tg from public.tokens where id = target for update;
  if tg is null or tg->>'gameId' is distinct from gid or tg->>'mapId' is distinct from tok->>'mapId' then raise exception 'Objetivo no válido'; end if;
  if tg->>'type' is distinct from 'monster' then raise exception 'Solo puedes atacar a enemigos'; end if;
  if coalesce((tg->>'hidden')::boolean, false) then raise exception 'Objetivo no válido'; end if;
  lvl := greatest(coalesce((tok->>'level')::int, 1), 1);
  if attack_id = 'weapon' then
    if tok->'wpn' is null or jsonb_typeof(tok->'wpn') <> 'object' then
      perform public._recalc(tid);
      select data into tok from public.tokens where id = tid;
    end if;
    aname := tok#>>'{wpn,name}'; rng := greatest(coalesce((tok#>>'{wpn,range}')::int, 1), 1); dmgx := tok#>>'{wpn,dmg}';
    bonus := coalesce((tok#>>'{wpn,atk}')::int, 0) - coalesce((tok->>'atk')::int, 0);
  elsif attack_id is null or attack_id = 'basic' then
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
    dead := true;
    share := public._kill_monster(target, gid, tg, tok->>'mapId');
  else
    update public.tokens set data = data || jsonb_build_object('hp', nhp) where id = target;
  end if;
  xpgain := case when hit then 10 else 2 end;
  perform public._grant_xp(tid, xpgain, gid);
  if not dead and dist <= greatest(coalesce((tg->>'range')::int, 1), 1)
     and public._los(tok->>'mapId', (tg->>'x')::numeric, (tg->>'y')::numeric, (tok->>'x')::numeric, (tok->>'y')::numeric) then
    counter := public._monster_strike(target, tid, gid, 'contraataque');
  end if;
  return jsonb_build_object('attack', aname, 'hit', hit, 'crit', crit, 'd20', d20, 'atk', atk, 'ac', ac, 'dmg', dmg,
    'hp', nhp, 'hpMax', hpmax, 'target', tg->>'name', 'dead', dead, 'xp', xpgain + share, 'counter', counter);
end $$;

-- Enlaza con el catálogo los objetos escritos a mano (sin tildes / mayúsculas)
update public.tokens t set data = jsonb_set(t.data, '{inventory,items}', (
  select coalesce(jsonb_agg(case when e->>'itemId' is null and i.id is not null
           then e || jsonb_build_object('itemId', i.id, 'name', i.name, 'consumable', i.consumable) else e end order by ord), '[]'::jsonb)
    from jsonb_array_elements(t.data#>'{inventory,items}') with ordinality as x(e, ord)
    left join lateral (select ii.id, ii.name, ii.consumable from public.items ii
                        where lower(translate(ii.name, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')) = lower(translate(trim(e->>'name'), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'))
                        limit 1) i on true))
 where jsonb_typeof(t.data#>'{inventory,items}') = 'array';

revoke all on function public._recalc(text) from public, anon, authenticated;
revoke all on function public._class_abil(text) from public, anon, authenticated;
revoke all on function public.token_recalc(text) from public;
revoke all on function public.item_equip(text, text, boolean) from public;
grant execute on function public.token_recalc(text) to authenticated;
grant execute on function public.item_equip(text, text, boolean) to authenticated;

-- Enlaza automáticamente los objetos escritos a mano con el catálogo (sin tildes ni mayúsculas)
create or replace function public._link_inv_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.data->'inventory'->'items' is null then return new; end if;
  new.data := jsonb_set(new.data, '{inventory,items}', (
    select coalesce(jsonb_agg(
      case when coalesce(e->>'itemId', '') = '' then
        coalesce((select e || jsonb_build_object('itemId', ii.id, 'consumable', ii.consumable)
                  from public.items ii
                  where lower(translate(ii.name, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')) = lower(translate(trim(e->>'name'), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'))
                     or lower(coalesce(ii.en, '')) = lower(trim(e->>'name'))
                  limit 1), e)
      else e end order by o), '[]'::jsonb)
    from jsonb_array_elements(new.data->'inventory'->'items') with ordinality as x(e, o)));
  return new;
end $$;
drop trigger if exists tokens_link_items on public.tokens;
create trigger tokens_link_items before insert or update on public.tokens
  for each row execute function public._link_inv_items();
