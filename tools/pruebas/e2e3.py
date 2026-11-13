import asyncio, json
from playwright.async_api import async_playwright
import os
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'e2e.py')).read().split('async def main(step):')[0]
ns = {}; exec(src, ns)
psql, check, new_client, wait_loaded, map_to_screen, dump, results, APP = ns['psql'], ns['check'], ns['new_client'], ns['wait_loaded'], ns['map_to_screen'], ns['dump'], ns['results'], ns['APP']

async def touch_drag(pg, a, b, steps=8):
    cdp = await pg.context.new_cdp_session(pg)
    pt = lambda x, y: [{'x': x, 'y': y, 'id': 1}]
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pt(*a)})
    for i in range(1, steps + 1):
        x = a[0] + (b[0] - a[0]) * i / steps; y = a[1] + (b[1] - a[1]) * i / steps
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pt(x, y)})
        await pg.wait_for_timeout(16)
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})

async def main():
    psql("truncate games, maps, tokens, rolls, templates, explored, game_members, game_secrets, join_attempts, profiles cascade; delete from storage.objects; delete from auth.users;")
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-proxy-server', '--autoplay-policy=no-user-gesture-required'])
        dctx, dm = await new_client(br, 'Nacho DM')
        await dm.goto(APP); await wait_loaded(dm)
        await dm.wait_for_selector('#lobby.open', timeout=15000)
        if await dm.is_checked('#newGamePriv'): await dm.uncheck('#newGamePriv')
        await dm.fill('#newGameName', 'Movil'); await dm.click('#btnCreateGame')
        await dm.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=15000)
        gid = psql("select id from games limit 1")
        await dm.click('#tabMapsBtn'); await dm.click('#btnImport')
        await dm.set_input_files('#fileInput', ['/tmp/vttest/map.json', '/tmp/vttest/map.png']); await dm.wait_for_timeout(600)
        await dm.click('#impCreate'); await dm.wait_for_function("!document.getElementById('importModal').classList.contains('open')", timeout=15000)
        await dm.click('#tabs button[data-tab=tokens]')
        await dm.click('#btnNewToken'); await dm.wait_for_timeout(300)
        await dm.fill('#tkName', 'Aria'); await dm.select_option('#tkType', 'pc'); await dm.select_option('#tkRace', 'Elfo')
        await dm.click('#tkSave'); await dm.wait_for_function("!document.getElementById('tokenModal').classList.contains('open')", timeout=15000)
        await dm.wait_for_timeout(600)
        tid = psql("select id from tokens where data->>'name'='Aria'")
        psql("update tokens set data = data || '{\"x\":350,\"y\":550}' where id='%s'" % tid)

        # jugador en móvil
        pctx, pl = await new_client(br, 'Laura', vp={'width': 390, 'height': 844}, mobile=True)
        await pl.goto(APP + '?unirse=' + gid); await wait_loaded(pl)
        await pl.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=20000)
        await pl.tap('#tabPjBtn'); await pl.wait_for_timeout(400); await pl.tap('.t-claim'); await pl.wait_for_timeout(1500)
        await pl.screenshot(path='/tmp/e3_movil_1.png')
        # botones de mapa visibles y tocables en el móvil
        for sel in ('#btnRuler', '#btnTpl', '#btnHideMap', '#tabAudioBtn'):
            check('Móvil: %s visible' % sel, await pl.is_visible(sel))
        # regla con toques
        await pl.tap('#btnRuler')
        a = await map_to_screen(pl, 350, 550); b = await map_to_screen(pl, 650, 550)
        await pl.touchscreen.tap(*a); await pl.wait_for_timeout(150); await pl.touchscreen.tap(*b); await pl.wait_for_timeout(300)
        tot = await pl.inner_text('#rulerTotal')
        check('Móvil: regla con dos toques (3 casillas = 15 ft)', tot.startswith('15 ft'), tot)
        await pl.screenshot(path='/tmp/e3_movil_regla.png')
        await pl.tap('#rulerExit')
        # plantilla arrastrando el dedo
        await pl.tap('#btnTpl'); await pl.tap('#tplBar button[data-shape=cone]')
        a = await map_to_screen(pl, 400, 600); b = await map_to_screen(pl, 400, 900)
        await touch_drag(pl, a, b); await pl.wait_for_timeout(1200)
        tp = psql("select data->>'shape', data->>'len' from templates")
        check('Móvil: cono creado arrastrando el dedo (15 ft)', tp == 'cone|15', tp)
        await pl.screenshot(path='/tmp/e3_movil_cono.png')
        await pl.tap('#tplExit')
        # ocultar mapa: las barras de herramientas desaparecen con el mapa
        await pl.tap('#btnHideMap'); await pl.wait_for_timeout(300)
        check('Móvil: mapa oculto', not await pl.is_visible('#cv'))
        # ronda: al tirar Movimiento el mapa vuelve y se puede tocar una casilla
        await dm.click('#tabs button[data-tab=init]'); await dm.wait_for_timeout(300)
        await dm.click('#rdStart'); await dm.wait_for_timeout(1500)
        await pl.tap('#tabPjBtn'); await pl.wait_for_timeout(500)
        # mientras tanto, el DM pone música varias veces (no debe pisar la ronda)
        await dm.click('#tabAudioBtn'); await dm.set_input_files('#audFile', ['/tmp/vttest/tone.wav']); await dm.wait_for_timeout(1500)
        await pl.tap('#actMove');
        await dm.click('.aud-toggle'); await dm.wait_for_timeout(50); await dm.click('.aud-toggle'); await dm.wait_for_timeout(50); await dm.click('.aud-toggle')
        await pl.wait_for_timeout(2000)
        rd = json.loads(psql("select data->'round' from games where id='%s'" % gid))
        check('El movimiento del jugador sigue en la ronda pese a los cambios de música', tid in (rd.get('pending') or {}), str(rd))
        check('Al tirar Movimiento el mapa vuelve a mostrarse', await pl.is_visible('#cv'))
        reach = await pl.evaluate("document.querySelectorAll('#cv').length && (window.__reach ? window.__reach() : -1)")
        await pl.screenshot(path='/tmp/e3_movil_mover.png')
        ga = json.loads(psql("select data->'audio' from games where id='%s'" % gid))
        check('La música quedó sonando (3 pulsaciones: ▶ ⏸ ▶)', len(ga['play']) == 1, str(ga['play']))
        st = await pl.evaluate("window.__audios.filter(a => !a.paused).length")
        check('El jugador la oye', st == 1, str(st))
        # el jugador toca una casilla iluminada para moverse
        cells = await pl.evaluate("window.__reachCells()")
        check('Hay casillas iluminadas para moverse', len(cells) > 0, str(len(cells)))
        if cells:
            b = await pl.locator('#cv').bounding_box()
            vis = []
            for c0 in cells:
                x0, y0 = await map_to_screen(pl, c0['x'], c0['y'])
                if b['x'] + 70 < x0 < b['x'] + b['width'] - 70 and b['y'] + 20 < y0 < b['y'] + b['height'] - 20: vis.append(c0)
            check('Hay casillas de movimiento a la vista con el zoom al PJ', len(vis) > 0, str(len(vis)))
            c = vis[0] if vis else cells[0]; x, y = await map_to_screen(pl, c['x'], c['y'])
            await pl.touchscreen.tap(x, y); await pl.wait_for_timeout(2000)
            pos = json.loads(psql("select json_build_object('x', data->'x', 'y', data->'y') from tokens where id='%s'" % tid))
            check('El jugador se mueve tocando la casilla', pos['x'] == c['x'] and pos['y'] == c['y'], '%s vs %s' % (pos, c))
        for who, pg in (('DM', dm), ('Jugador móvil', pl)):
            errs = [e for e in pg.errs if 'favicon' not in e and '404 (File not found)' not in e]
            check('Sin errores JS en ' + who, not errs, ' | '.join(errs[:5]))
        await br.close()
    bad = [r for r in results if not r[1]]
    print('\nRESUMEN: %d OK, %d fallos' % (len(results) - len(bad), len(bad)))

async def runner():
    try: await main()
    except Exception as e:
        import traceback; traceback.print_exc()
        bad = [r for r in results if not r[1]]
        print('RESUMEN PARCIAL: %d OK, %d fallos' % (len(results) - len(bad), len(bad)))
asyncio.run(runner())
