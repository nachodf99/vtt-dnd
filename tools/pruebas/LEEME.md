# Pruebas de extremo a extremo

Un servidor que imita lo que la app usa de Supabase, sobre un PostgreSQL local **con las mismas políticas RLS** que producción, y tres baterías de pruebas con varios navegadores a la vez (DM, jugadores, proyector, móvil).

## Requisitos
PostgreSQL 16, Node 18+, Python 3 con `playwright` y `Pillow`, y Google Chrome.

## Puesta en marcha
```bash
# 1. PostgreSQL de pruebas en /tmp/pg (puerto 5433)
mkdir -p /tmp/pg && /usr/lib/postgresql/16/bin/initdb -D /tmp/pg/data -A trust
/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg/data -o '-p 5433 -k /tmp/pg' -l /tmp/pg/log start
P="psql -h /tmp/pg -p 5433 -U postgres -q"
$P -c "create database vtt"
cd supabase
for f in ../tools/pruebas/stubs.sql schema.sql rounds.sql security.sql combat_v2.sql items.sql effects.sql equipment.sql equipment_items.sql mesa_extras.sql; do $P -d vtt -f $f; done
cd ..
# avisos de cambios para el realtime simulado
$P -d vtt -c "create or replace function public._test_notify() returns trigger language plpgsql as \$\$ begin perform pg_notify('chg', json_build_object('t', tg_table_name, 'op', tg_op, 'id', coalesce(new.id, old.id))::text); return null; end \$\$;"
for t in games maps tokens rolls templates; do $P -d vtt -c "create trigger _test_notify after insert or update or delete on public.$t for each row execute function public._test_notify()"; done

# 2. Servidor simulado de Supabase (puerto 54321) y la app (puerto 8765)
cd tools/pruebas && npm install && node server.js &
cd ../.. && python3 -m http.server 8765 &

# 3. Recursos y pruebas
python3 tools/pruebas/make_assets.py
python3 tools/pruebas/e2e.py    # luces, visión, regla, plantillas, explorado, sonido (35 comprobaciones)
python3 tools/pruebas/e2e2.py   # UVTT, antorchas, autoplay bloqueado, mezcla de pistas, proyector, reloj desfasado, rendimiento
python3 tools/pruebas/e2e3.py   # móvil: toques, arrastre, ocultar mapa, rondas mientras el DM cambia la música
python3 tools/pruebas/e2e4_inmersion.py   # lluvia, parpadeo, cartel de ronda, ataques hasta matar, calavera, pergamino, cambio de escena, modo inmersivo
```
Las pruebas vacían las tablas de la base de datos **de pruebas** al empezar. Nunca apuntes el servidor simulado a un proyecto real.
