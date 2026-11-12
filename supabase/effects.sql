-- ============================================================
-- Mesa de Rol — VTT · Uso de objetos con efectos automáticos (reglas 2024)
-- Requiere rounds.sql, combat_v2.sql e items.sql. Re-ejecutable (sin DROP).
-- ============================================================

-- Muerte de un monstruo: desaparece y su XP se reparte entre el grupo
create or replace function public._kill_monster(target text, gid text, tg jsonb, map_id text) returns int
language plpgsql security definer set search_path = public as $$
declare mxp int; nparty int; share int; party record;
begin
  delete from public.tokens where id = target;
  mxp := coalesce((tg->>'xp')::int, greatest(20, coalesce((tg->>'hpMax')::int, 0) * 5));
  select count(*) into nparty from public.tokens
   where data->>'gameId' = gid and data->>'mapId' = map_id and data->>'type' = 'pc' and coalesce(data->>'ownerId', '') <> '';
  nparty := greatest(nparty, 1);
  share := ceil(mxp::numeric / nparty);
  perform public._log_npc(gid, '💀', '💀 ' || coalesce(tg->>'name', '') || ' ha muerto', mxp,
    '+' || share || ' XP para cada miembro del grupo (' || mxp || ' XP en total)');
  for party in select id from public.tokens
                where data->>'gameId' = gid and data->>'mapId' = map_id and data->>'type' = 'pc' and coalesce(data->>'ownerId', '') <> '' loop
    perform public._grant_xp(party.id, share, gid);
  end loop;
  return share;
end $$;

-- Usar un objeto del inventario
--  heal : acción adicional (no gasta la acción de la ronda)
--  dmg  : gasta la acción de la ronda; objetivo a alcance y a la vista; salvación de Des / impacto automático
--  note : narrativo, queda en el registro
create or replace function public.item_use(tid text, iid text, target text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tok jsonb; it jsonb; fx jsonb; nm text; q int; gid text; g jsonb; res jsonb; descr text;
        heal int; hp int; hpmax int; nhp int;
        tg jsonb; grid numeric; dist int; rng int; dc int; d20 int; sbonus int; saved boolean := false; dmg int := 0; raw int;
        only jsonb; ctype text; immune boolean := false; burn boolean := false; dead boolean := false; share int := 0;
        counter jsonb := null; det text; mode text;
begin
  if auth.uid() is null then raise exception 'No has iniciado sesión'; end if;
  select data into tok from public.tokens where id = tid and data->>'ownerId' = auth.uid()::text;
  if tok is null then raise exception 'Ese no es tu personaje'; end if;
  if coalesce((tok->>'hpMax')::int, 0) > 0 and coalesce((tok->>'hp')::int, 0) <= 0 then raise exception 'Estás inconsciente: no puedes usar objetos'; end if;
  select e into it from jsonb_array_elements(coalesce(tok#>'{inventory,items}', '[]'::jsonb)) e where e->>'id' = iid;
  if it is null then raise exception 'Objeto no encontrado'; end if;
  nm := coalesce(it->>'name', 'objeto');
  q := coalesce((it->>'qty')::int, 1);
  if coalesce((it->>'consumable')::boolean, false) and q <= 0 then raise exception '% no tiene cargas ni usos', nm; end if;
  select i.fx, i.descr into fx, descr from public.items i where i.id = it->>'itemId';
  fx := coalesce(fx, it->'fx', '{"t":"note"}'::jsonb);
  gid := tok->>'gameId';

  if fx->>'t' = 'heal' then
    heal := greatest(public.roll_dice(fx->>'dice'), 1);
    hp := coalesce((tok->>'hp')::int, 0); hpmax := coalesce((tok->>'hpMax')::int, 0);
    nhp := case when hpmax > 0 then least(hpmax, hp + heal) else hp + heal end;
    update public.tokens set data = data || jsonb_build_object('hp', nhp) where id = tid;
    perform public._log_roll(gid, tok->>'ownerName', '🧪 ' || coalesce(tok->>'name', '') || ' bebe ' || nm || ' (' || (fx->>'dice') || ')', heal,
      '+' || heal || ' PV → ' || nhp || '/' || hpmax || ' · acción adicional');
    res := jsonb_build_object('t', 'heal', 'name', nm, 'heal', heal, 'hp', nhp, 'hpMax', hpmax);

  elsif fx->>'t' = 'dmg' then
    if target is null then raise exception 'Elige un objetivo para %', nm; end if;
    select * into tok, gid, g from public._round_check(tid);          -- gasta la acción de la ronda
    select data into tg from public.tokens where id = target for update;
    if tg is null or tg->>'gameId' is distinct from gid or tg->>'mapId' is distinct from tok->>'mapId'
       or tg->>'type' is distinct from 'monster' or coalesce((tg->>'hidden')::boolean, false) then raise exception 'Objetivo no válido'; end if;
    grid := public._grid_of(tok->>'mapId');
    rng := greatest(coalesce((fx->>'range')::int, 4), 1);
    dist := round(greatest(abs((tg->>'x')::numeric - (tok->>'x')::numeric), abs((tg->>'y')::numeric - (tok->>'y')::numeric)) / grid);
    if dist > rng then raise exception 'Fuera de alcance: está a % casillas y % llega a %', dist, nm, rng; end if;
    if not public._los(tok->>'mapId', (tok->>'x')::numeric, (tok->>'y')::numeric, (tg->>'x')::numeric, (tg->>'y')::numeric) then
      raise exception 'No tienes línea de visión con %', tg->>'name'; end if;
    raw := greatest(public.roll_dice(fx->>'dice'), 1);
    mode := coalesce(fx->>'mode', 'save');
    if mode = 'auto' then
      dmg := raw; det := 'impacto automático';
    else
      dc := coalesce((fx->>'dc')::int, 8 + coalesce((tok->>'atk')::int, 0));   -- CD 8 + Des + competencia (≈ ataque del PJ)
      sbonus := coalesce((tg->>'save')::int, 1);
      d20 := public.roll_dice('1d20');
      saved := d20 + sbonus >= dc;
      if not saved then dmg := raw;
      elsif coalesce((fx->>'half')::boolean, false) then dmg := raw / 2;
      else dmg := 0; end if;
      det := 'salvación de Des [' || d20 || '] ' || case when sbonus >= 0 then '+' else '' end || sbonus || ' vs CD ' || dc || ' → ' ||
             case when saved then 'la supera' else 'la falla' end;
    end if;
    only := fx->'only';
    ctype := lower(coalesce(tg->>'ctype', ''));
    if only is not null and jsonb_array_length(only) > 0 and not (only ? ctype) then
      immune := true; dmg := 0;
      det := det || ' · no le afecta (solo ' || (select string_agg(x, ' / ') from jsonb_array_elements_text(only) x) || ')';
    end if;
    burn := coalesce((fx->>'burn')::boolean, false) and not saved and not immune;
    hp := coalesce((tg->>'hp')::int, 0); hpmax := coalesce((tg->>'hpMax')::int, 0);
    nhp := greatest(hp - dmg, 0);
    det := det || ' · ' || dmg || ' de ' || coalesce(fx->>'dtype', 'daño') || case when burn then ' · 🔥 ¡ardiendo!' else '' end ||
           case when dmg > 0 and nhp > 0 then ' (' || coalesce(tg->>'name', '') || ' ' || nhp || '/' || hpmax || ')' else '' end;
    perform public._log_roll(gid, tok->>'ownerName', '💥 ' || coalesce(tok->>'name', '') || ' usa ' || nm || ' contra ' || coalesce(tg->>'name', ''), dmg, det);
    perform public._round_done(gid, tid, 'attack');
    if dmg > 0 and nhp = 0 then
      dead := true;
      share := public._kill_monster(target, gid, tg, tok->>'mapId');
    else
      update public.tokens set data = data || jsonb_build_object('hp', nhp) ||
             case when burn then jsonb_build_object('burning', true) else '{}'::jsonb end
       where id = target;
    end if;
    perform public._grant_xp(tid, case when dmg > 0 then 10 else 2 end, gid);
    if not dead and dist <= greatest(coalesce((tg->>'range')::int, 1), 1)
       and public._los(tok->>'mapId', (tg->>'x')::numeric, (tg->>'y')::numeric, (tok->>'x')::numeric, (tok->>'y')::numeric) then
      counter := public._monster_strike(target, tid, gid, 'contraataque');
    end if;
    res := jsonb_build_object('t', 'dmg', 'name', nm, 'target', tg->>'name', 'dmg', dmg, 'saved', saved, 'mode', mode,
      'immune', immune, 'burn', burn, 'dead', dead, 'hp', nhp, 'hpMax', hpmax, 'xp', (case when dmg > 0 then 10 else 2 end) + share, 'counter', counter);

  else
    insert into public.rolls (id, data) values (gen_random_uuid()::text, jsonb_build_object(
      'ts', (extract(epoch from clock_timestamp()) * 1000)::bigint, 'uid', auth.uid()::text,
      'who', coalesce(tok->>'ownerName', 'Jugador'), 'gameId', gid,
      'msg', '🎒 ' || coalesce(tok->>'name', '') || ' usa ' || nm || case when descr is not null and descr <> '' then ' — ' || descr else '' end));
    res := jsonb_build_object('t', 'note', 'name', nm, 'descr', descr);
  end if;

  -- Gastar una unidad / carga
  if coalesce((it->>'consumable')::boolean, false) then
    q := q - 1;
    update public.tokens set data = jsonb_set(data, '{inventory,items}', coalesce((
      select jsonb_agg(case when e->>'id' = iid then jsonb_set(e, '{qty}', to_jsonb(q)) else e end)
        from jsonb_array_elements(data#>'{inventory,items}') e
       where not (e->>'id' = iid and q <= 0 and not coalesce((fx->>'keep')::boolean, false))), '[]'::jsonb))
     where id = tid;
  end if;
  return res || jsonb_build_object('qty', q);
end $$;

-- Al pasar de ronda (DM): las criaturas que arden sufren 1d4 de fuego
create or replace function public.dm_round_tick(gid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; d int; nhp int; res jsonb := '[]'::jsonb;
begin
  if not public.is_game_dm(gid) then raise exception 'Solo el DM puede pasar de ronda'; end if;
  for t in select id, data from public.tokens where data->>'gameId' = gid and coalesce((data->>'burning')::boolean, false) loop
    d := public.roll_dice('1d4');
    nhp := greatest(coalesce((t.data->>'hp')::int, 0) - d, 0);
    perform public._log_npc(gid, '🔥', '🔥 ' || coalesce(t.data->>'name', '') || ' arde', d,
      d || ' de fuego' || case when nhp > 0 then ' (' || nhp || '/' || coalesce(t.data->>'hpMax', '?') || ')' else '' end);
    if t.data->>'type' = 'monster' and nhp = 0 then
      perform public._kill_monster(t.id, gid, t.data, t.data->>'mapId');
    else
      update public.tokens set data = data || jsonb_build_object('hp', nhp) where id = t.id;
    end if;
    res := res || jsonb_build_array(jsonb_build_object('name', t.data->>'name', 'dmg', d, 'hp', nhp));
  end loop;
  return res;
end $$;

revoke all on function public._kill_monster(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.item_use(text, text, text) from public;
revoke all on function public.dm_round_tick(text) from public;
grant execute on function public.item_use(text, text, text) to authenticated;
grant execute on function public.dm_round_tick(text) to authenticated;
