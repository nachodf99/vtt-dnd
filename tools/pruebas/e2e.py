import asyncio, json, sys, subprocess, os
ASSETS = os.environ.get('VTT_ASSETS', '/tmp/vttest')
from playwright.async_api import async_playwright

APP = 'http://localhost:8765/'
CFG = json.dumps({'url': 'http://localhost:54321', 'anon': 'anon-key', 'env': 'preview'})
INIT = """
window.__audios = [];
const _Audio = window.Audio;
window.Audio = function(...a){ const el = new _Audio(...a); window.__audios.push(el); return el; };
window.Audio.prototype = _Audio.prototype;
"""
def psql(q):
    return subprocess.run(['psql', '-h', '/tmp/pg', '-p', '5433', '-U', 'postgres', '-d', 'vtt', '-At', '-c', q], capture_output=True, text=True).stdout.strip()

results = []
def check(name, ok, extra=''):
    results.append((name, ok, extra))
    print(('✅' if ok else '❌'), name, extra, flush=True)

async def new_client(browser, name, vp=None, mobile=False, state=None):
    ctx = await browser.new_context(viewport=vp or {'width': 1280, 'height': 800}, is_mobile=mobile, has_touch=mobile, storage_state=state)
    await ctx.add_init_script(INIT + "try{ localStorage.setItem('vtt_name', JSON.stringify('%s')); localStorage.setItem('vtt_tour_dm','1'); localStorage.setItem('vtt_tour_pl','1'); }catch(e){}" % name)
    await ctx.route('**/api/config', lambda r: r.fulfill(status=200, content_type='application/json', body=CFG))
    pg = await ctx.new_page()
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append('PAGEERR ' + str(e)))
    pg.on('console', lambda m: pg.errs.append(m.type + ': ' + m.text) if m.type == 'error' else None)
    return ctx, pg

async def dump(pg, tag):
    try:
        t = await pg.inner_text('#toasts'); print('   [%s] toasts:' % tag, t.replace('\n', ' | ')[:300]); print('   [%s] errs:' % tag, pg.errs[-5:])
        await pg.screenshot(path='/tmp/e2e_fail_%s.png' % tag)
    except Exception as e: print('dump', e)

async def wait_loaded(pg):
    await pg.wait_for_function("document.getElementById('loading').style.display === 'none'", timeout=20000)

async def cv_box(pg):
    return await pg.locator('#cv').bounding_box()

async def map_to_screen(pg, x, y):
    # usa la cámara expuesta indirectamente: leemos S.cam a través de un atributo de depuración
    cam = await pg.evaluate("window.__cam ? window.__cam() : null")
    b = await cv_box(pg)
    return b['x'] + cam['x'] + x * cam['s'], b['y'] + cam['y'] + y * cam['s']

async def main(step):
    psql("truncate games, maps, tokens, rolls, templates, explored, game_members, game_secrets, join_attempts, profiles cascade; delete from storage.objects; delete from auth.users;")
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-proxy-server', '--autoplay-policy=no-user-gesture-required'])
        dctx, dm = await new_client(br, 'Nacho DM')
        await dm.goto(APP); await wait_loaded(dm)
        await dm.wait_for_selector('#lobby.open', timeout=15000)
        await dm.fill('#newGameName', 'Prueba E2E'); await dm.click('#btnCreateGame')
        await dm.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=15000)
        gid = psql("select id from games order by updated_at desc limit 1")
        check('DM crea partida', bool(gid), gid)
        # importar mapa con luces
        await dm.click('#tabMapsBtn'); await dm.click('#btnImport')
        await dm.set_input_files('#fileInput', ['/tmp/vttest/map.json', '/tmp/vttest/map.png'])
        await dm.wait_for_timeout(600)
        info = await dm.inner_text('#importInfo')
        check('Importa 2 luces', '2 luces' in info, info.replace('\n', ' '))
        await dm.click('#impCreate')
        await dm.wait_for_timeout(2500); await dump(dm, 'import')
        await dm.wait_for_function("!document.getElementById('importModal').classList.contains('open')", timeout=15000)
        await dm.wait_for_timeout(800)
        mrow = json.loads(psql("select data from maps order by updated_at desc limit 1") or '{}')
        check('Mapa guardado con luces y oscuridad', len(mrow.get('lights', [])) == 2 and mrow.get('darkness') == 0.8 and mrow.get('rememberExplored') is True,
              'lights=%s dark=%s' % (len(mrow.get('lights', [])), mrow.get('darkness')))
        l0 = mrow['lights'][0] if mrow.get('lights') else {}
        check('Luz: radio en casillas (10/20 ft → 2/4)', l0.get('bright') == 2 and l0.get('dim') == 4, str(l0))
        # PJ
        await dm.click('#tabs button[data-tab=tokens]')
        await dm.click('#btnNewToken'); await dm.wait_for_timeout(300)
        await dm.fill('#tkName', 'Aria'); await dm.select_option('#tkType', 'pc'); await dm.select_option('#tkRace', 'Humano')
        await dm.click('#tkSave')
        await dm.wait_for_function("!document.getElementById('tokenModal').classList.contains('open')", timeout=15000)
        await dm.wait_for_timeout(800)
        tid = psql("select id from tokens where data->>'name'='Aria'")
        check('PJ creado', bool(tid))
        # colocar el PJ en la sala izquierda (150,450) con SQL de DM (más fiable que arrastrar)
        psql("update tokens set data = data || '{\"x\":150,\"y\":450}' where id='%s'" % tid)
        # monstruo oculto en la oscuridad de la sala izquierda y otro junto a la luz
        await dm.click('#btnNewToken'); await dm.wait_for_timeout(300)
        await dm.fill('#tkName', 'Goblin'); await dm.select_option('#tkType', 'monster'); await dm.click('#tkSave')
        await dm.wait_for_function("!document.getElementById('tokenModal').classList.contains('open')", timeout=15000)
        await dm.wait_for_timeout(500)
        gob = psql("select id from tokens where data->>'name'='Goblin'")
        psql("update tokens set data = data || '{\"x\":600,\"y\":350,\"hidden\":false}' where id='%s'" % gob)

        # ---------- Jugador ----------
        pctx, pl = await new_client(br, 'Laura')
        await pl.goto(APP + '?unirse=' + gid + '&c=' + psql("select coalesce((select code from game_secrets where game_id='%s'),'')" % gid)); await wait_loaded(pl)
        try:
            await pl.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=20000)
        except Exception:
            await dump(pl, 'join'); raise
        check('Jugador entra en la partida', True)
        await pl.click('#tabPjBtn'); await pl.wait_for_timeout(500)
        await pl.click('.t-claim'); await pl.wait_for_timeout(1500)
        owner = psql("select data->>'ownerName' from tokens where id='%s'" % tid)
        if owner != 'Laura': await dump(pl, 'claim'); print('   tokens:', psql("select id, data->>'name', data->>'type', data->>'hidden', data->>'mapId' from tokens"))
        check('Jugador reclama a Aria', owner == 'Laura', owner)
        await pl.wait_for_timeout(1000)
        await pl.screenshot(path='/tmp/e2e_pl_dark.png')
        # visibilidad del goblin: está en (550,150), detrás del muro horizontal (200..500,300) → visto? y a oscuras
        vis = await pl.evaluate("window.__tokVisible ? window.__tokVisible('%s') : null" % gob)
        check('Goblin en la oscuridad NO visible para el jugador humano', vis is False, str(vis))
        # el DM le da visión en la oscuridad (Elfo)
        psql("update tokens set data = data || '{\"race\":\"Elfo\"}' where id='%s'" % tid)
        await pl.wait_for_timeout(1200)
        vis2 = await pl.evaluate("window.__tokVisible('%s')" % gob)
        check('Con visión en la oscuridad (elfo) el goblin a 4-5 casillas se ve', vis2 is True, str(vis2))
        await pl.screenshot(path='/tmp/e2e_pl_elfo.png')
        psql("update tokens set data = data || '{\"race\":\"Humano\"}' where id='%s'" % tid)
        await pl.wait_for_timeout(800)
        # luz apagada/encendida por el DM
        await dm.click('#btnWalls'); await dm.wait_for_timeout(300)
        x, y = await map_to_screen(dm, 350, 700)
        await dm.mouse.click(x, y); await dm.wait_for_timeout(1000)
        off = psql("select data->'lightsOff' from maps order by updated_at desc limit 1")
        check('DM apaga una luz tocándola', off == '{"0": true}', off)
        await pl.wait_for_timeout(800)
        lit = await pl.evaluate("window.__seen(350,700)")
        check('Con la luz apagada el jugador no ve esa zona', lit is False, str(lit))
        await dm.mouse.click(x, y); await dm.wait_for_timeout(1000)
        await pl.wait_for_timeout(800)
        lit = await pl.evaluate("window.__seen(350,700)")
        check('Al encenderla vuelve a verla', lit is True, str(lit))
        await dm.click('#btnWalls')

        # ---------- Regla compartida ----------
        await pl.click('#btnRuler')
        a = await map_to_screen(pl, 150, 450); b2 = await map_to_screen(pl, 450, 450); c = await map_to_screen(pl, 450, 750)
        await pl.mouse.click(*a); await pl.mouse.click(*b2); await pl.mouse.click(*c)
        await pl.wait_for_timeout(400)
        tot = await pl.inner_text('#rulerTotal')
        check('Regla: 3 + 3 casillas = 30 ft', tot.startswith('30 ft'), tot)
        await dm.wait_for_timeout(500)
        rr = await dm.evaluate("window.__rulers()")
        check('El DM ve la regla del jugador', bool(rr) and rr[0]['n'] == 3 and rr[0]['name'] == 'Laura', str(rr))
        await dm.screenshot(path='/tmp/e2e_dm_ruler.png')
        await pl.click('#rulerExit'); await dm.wait_for_timeout(500)
        rr = await dm.evaluate("window.__rulers()")
        check('Al salir de la regla desaparece para el DM', rr == [], str(rr))

        # ---------- Plantillas ----------
        await pl.click('#btnTpl'); await pl.click('#tplBar button[data-shape=circle]')
        o = await map_to_screen(pl, 800, 600); e = await map_to_screen(pl, 1000, 600)
        await pl.mouse.move(*o); await pl.mouse.down(); await pl.mouse.move((o[0]+e[0])/2, o[1], steps=4); await pl.mouse.move(*e, steps=4); await pl.mouse.up()
        await pl.wait_for_timeout(1200)
        trow = psql("select data from templates")
        check('Jugador crea plantilla (círculo 10 ft)', '"len": 10' in trow and '"shape": "circle"' in trow, trow[:400])
        n_dm = await dm.evaluate("window.__tpls()")
        check('El DM ve la plantilla al momento', n_dm == 1, str(n_dm))
        cells = await dm.evaluate("window.__tplCells(0)")
        check('Círculo de 10 ft centrado en intersección marca 12 casillas', cells == 12, str(cells))
        await dm.screenshot(path='/tmp/e2e_dm_tpl.png')
        # el DM la borra tocándola
        await dm.click('#btnTpl'); await dm.wait_for_timeout(200)
        dx, dy = await map_to_screen(dm, 850, 620)
        await dm.mouse.click(dx, dy); await dm.wait_for_timeout(1200)
        check('El DM borra la plantilla tocándola', psql("select count(*) from templates") == '0')
        check('Desaparece también para el jugador', await pl.evaluate("window.__tpls()") == 0)
        # un jugador NO puede borrar la de otro (RLS)
        await dm.click('#tplBar button[data-shape=cone]')
        o = await map_to_screen(dm, 1000, 500); e = await map_to_screen(dm, 1000, 800)
        await dm.mouse.move(*o); await dm.mouse.down(); await dm.mouse.move(o[0], (o[1]+e[1])/2, steps=4); await dm.mouse.move(*e, steps=4); await dm.mouse.up()
        await dm.wait_for_timeout(1200)
        check('DM crea cono', psql("select count(*) from templates") == '1')
        tpid = psql("select id from templates")
        hack = await pl.evaluate("""async (id) => { const r = await window.__sbClient().from('templates').delete().eq('id', id).select('id'); return r.data ? r.data.length : r.error && r.error.message; }""", tpid)
        check('RLS: el jugador no puede borrar la plantilla del DM', hack == 0 and psql("select count(*) from templates") == '1', str(hack))
        await pl.click('#tplExit'); await dm.click('#tplExit')

        # ---------- Zonas exploradas ----------
        psql("update tokens set data = data || '{\"x\":1050,\"y\":450}' where id='%s'" % tid)   # entra en la sala derecha
        await pl.wait_for_timeout(6000)
        exp = psql("select length(data->>'png') from explored")
        check('Se guarda lo explorado en la BD', exp.isdigit() and int(exp) > 100, exp)
        before = await pl.evaluate("window.__expPixels()")
        await pl.reload(); await wait_loaded(pl)
        await pl.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=20000)
        await pl.wait_for_timeout(2500)
        after = await pl.evaluate("window.__expPixels()")
        check('Tras recargar se recupera lo explorado', after >= before * 0.9 and after > 0, '%s → %s' % (before, after))
        # borrar localStorage y recargar: debe venir de la BD
        await pl.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('vtt_exp_')).forEach(k=>localStorage.removeItem(k))")
        await pl.reload(); await wait_loaded(pl)
        await pl.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=20000)
        await pl.wait_for_timeout(2500)
        after2 = await pl.evaluate("window.__expPixels()")
        check('Sin caché local también se recupera desde Supabase', after2 >= before * 0.9, '%s → %s' % (before, after2))
        # reinicio por el DM
        await dm.click('#tabMapsBtn'); await dm.wait_for_timeout(300)
        await dm.click('#resetExplored'); await dm.click('#resetExplored'); await dm.wait_for_timeout(1500)
        after3 = await pl.evaluate("window.__expPixels()")
        seen_now = await pl.evaluate("window.__seenPixels()")
        check('El DM reinicia lo explorado y al jugador solo le queda lo que ve ahora', after3 <= seen_now * 1.05 + 50, 'explorado=%s visto=%s' % (after3, seen_now))

        # ---------- Audio ----------
        await dm.click('#tabAudioBtn'); await dm.wait_for_timeout(300)
        await dm.set_input_files('#audFile', ['/tmp/vttest/tone.wav']); await dm.wait_for_timeout(2000)
        ga = json.loads(psql("select data->'audio' from games where id='%s'" % gid) or 'null')
        check('DM sube audio (bucket acepta audio/wav)', ga and len(ga['tracks']) == 1, str(ga)[:150])
        await dm.click('.aud-toggle'); await dm.wait_for_timeout(2500)
        st = await pl.evaluate("window.__audios.map(a => ({src: a.src.slice(-12), paused: a.paused, t: a.currentTime, vol: a.volume}))")
        check('El jugador oye la pista', len(st) == 1 and not st[0]['paused'], str(st))
        btn = await pl.inner_text('#btnAudio')
        check('Botón 🔊 visible para el jugador', btn.strip() == '🔊', btn)
        await pl.click('#btnAudio'); await pl.wait_for_timeout(300)
        st = await pl.evaluate("window.__audios.map(a => a.volume)")
        check('Silenciar en el jugador pone volumen 0', st and st[-1] == 0, str(st))
        await pl.click('#btnAudio')
        # jugador que llega tarde: arranca sincronizado
        p2ctx, pl2 = await new_client(br, 'Tardón')
        await pl2.goto(APP + '?unirse=' + gid + '&c=' + psql("select coalesce((select code from game_secrets where game_id='%s'),'')" % gid)); await wait_loaded(pl2)
        await pl2.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=20000)
        await pl2.wait_for_timeout(2000)
        st2 = await pl2.evaluate("window.__audios.map(a => ({paused: a.paused, t: a.currentTime, d: a.duration}))")
        check('Un jugador que entra tarde también la oye', len(st2) == 1 and not st2[0]['paused'], str(st2))
        await dm.click('#audStopAll'); await dm.wait_for_timeout(1500)
        st = await pl.evaluate("window.__audios.map(a => a.paused)")
        check('Parar todo detiene el audio del jugador', all(st), str(st))
        await pl.screenshot(path='/tmp/e2e_pl_final.png')
        await dm.screenshot(path='/tmp/e2e_dm_final.png')

        for who, pg in (('DM', dm), ('Jugador', pl), ('Tardón', pl2)):
            errs = [e for e in pg.errs if 'favicon' not in e and '404 (File not found)' not in e]
            check('Sin errores JS en ' + who, not errs, ' | '.join(errs[:5]))
        await br.close()
    bad = [r for r in results if not r[1]]
    print('\nRESUMEN: %d OK, %d fallos' % (len(results) - len(bad), len(bad)))

async def runner():
    try:
        await main('all')
    except Exception as e:
        print('EXCEPCIÓN:', e)
        bad = [r for r in results if not r[1]]
        print('RESUMEN PARCIAL: %d OK, %d fallos' % (len(results) - len(bad), len(bad)))
asyncio.run(runner())
