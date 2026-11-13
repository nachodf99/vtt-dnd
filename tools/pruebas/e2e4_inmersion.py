import asyncio, json, os
from playwright.async_api import async_playwright
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'e2e.py')).read().split('async def main(step):')[0]
ns = {}; exec(src, ns)
psql, check, new_client, wait_loaded, map_to_screen, results, APP = ns['psql'], ns['check'], ns['new_client'], ns['wait_loaded'], ns['map_to_screen'], ns['results'], ns['APP']
SHOTS = os.environ.get('SHOTS', '1') == '1'
async def shot(pg, name):
    if SHOTS: await pg.screenshot(path='/tmp/im_%s.png' % name)

async def main():
    psql("truncate games, maps, tokens, rolls, templates, explored, game_members, game_secrets, join_attempts, profiles cascade; delete from storage.objects; delete from auth.users;")
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-proxy-server', '--autoplay-policy=no-user-gesture-required'])
        dctx, dm = await new_client(br, 'Nacho DM')
        await dm.goto(APP); await wait_loaded(dm)
        await dm.wait_for_selector('#lobby.open', timeout=15000)
        if await dm.is_checked('#newGamePriv'): await dm.uncheck('#newGamePriv')
        await dm.fill('#newGameName', 'Palma la negra'); await dm.click('#btnCreateGame')
        await dm.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=15000)
        gid = psql("select id from games limit 1")
        await dm.click('#tabMapsBtn'); await dm.click('#btnImport')
        await dm.set_input_files('#fileInput', ['/tmp/vttest/map.json', '/tmp/vttest/map.png']); await dm.wait_for_timeout(600)
        await dm.click('#impCreate'); await dm.wait_for_function("!document.getElementById('importModal').classList.contains('open')", timeout=15000)
        await dm.click('#tabs button[data-tab=tokens]')
        await dm.click('#btnNewToken'); await dm.wait_for_timeout(300)
        await dm.fill('#tkName', 'Aria'); await dm.select_option('#tkType', 'pc'); await dm.select_option('#tkRace', 'Humano'); await dm.select_option('#tkLight', 'torch'); await dm.click('#tkSave')
        await dm.wait_for_timeout(900)
        await dm.click('#btnNewToken'); await dm.wait_for_timeout(300)
        await dm.fill('#tkName', 'Lobo'); await dm.select_option('#tkType', 'monster'); await dm.click('#tkSave')
        await dm.wait_for_timeout(900)
        aria = psql("select id from tokens where data->>'name'='Aria'"); lobo = psql("select id from tokens where data->>'name'='Lobo'")
        psql("update tokens set data = data || '{\"x\":350,\"y\":550}' where id='%s'" % aria)
        psql("update tokens set data = data || '{\"x\":450,\"y\":550,\"hidden\":false,\"hp\":2,\"hpMax\":2,\"ac\":1}' where id='%s'" % lobo)
        # clima: lluvia
        await dm.click('#tabMapsBtn'); await dm.wait_for_timeout(300)
        await dm.select_option('#setWeather', 'rain'); await dm.wait_for_timeout(900)
        check('Clima guardado en el mapa', psql("select data->>'weather' from maps limit 1") == 'rain')
        # jugador en escritorio y proyector
        pctx, pl = await new_client(br, 'Laura')
        await pl.goto(APP + '?unirse=' + gid); await wait_loaded(pl)
        await pl.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=20000)
        await pl.click('#tabPjBtn'); await pl.wait_for_timeout(300); await pl.click('.t-claim'); await pl.wait_for_timeout(1500)
        prctx, pr = await new_client(br, 'Nacho DM', vp={'width': 1600, 'height': 900}, state=await dctx.storage_state())
        await pr.goto(APP + '?proyector=' + gid); await wait_loaded(pr); await pr.wait_for_timeout(2500)
        mctx, mo = await new_client(br, 'Movil', vp={'width': 390, 'height': 844}, mobile=True)
        await mo.goto(APP + '?unirse=' + gid); await wait_loaded(mo)
        await mo.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=20000)
        await mo.wait_for_timeout(800)
        vis = await pl.evaluate("getComputedStyle(document.getElementById('fxLayer')).display")
        check('La lluvia se ve en el jugador', vis == 'block', vis)
        await shot(pl, 'jugador_lluvia'); await shot(pr, 'proyector_lluvia')
        # parpadeo: dos fotogramas distintos con luces en la oscuridad
        f1 = await pl.evaluate("document.getElementById('cv').toDataURL().length")
        await pl.wait_for_timeout(180)
        f2 = await pl.evaluate("document.getElementById('cv').toDataURL().length")
        check('Las antorchas parpadean (el lienzo cambia solo)', f1 != f2, '%s vs %s' % (f1, f2))
        # ronda: cartel
        await dm.click('#tabs button[data-tab=init]'); await dm.wait_for_timeout(300)
        await dm.click('#rdStart')
        try: await pl.wait_for_function("window.__fx().nBanners >= 1", timeout=5000)
        except Exception: print('   DEBUG banner', await pl.evaluate('JSON.stringify(window.__fx())'))
        b = await pl.evaluate("[window.__fx().nBanners, document.getElementById('roundBanner').textContent]")
        check('Cartel «Ronda 1 · Te toca actuar» en el jugador', b[0] >= 1 and 'Ronda 1' in b[1] and 'Te toca' in b[1], str(b))
        bp = await pr.evaluate("document.getElementById('roundBanner').textContent")
        check('Cartel de ronda en el proyector (sin texto de DM)', bp == 'Ronda 1', bp)
        await shot(pl, 'jugador_ronda'); await shot(pr, 'proyector_ronda')
        # ataques hasta matar al lobo
        dead = False; saw = set()
        for rnd in range(15):
            await pl.wait_for_timeout(600)
            atk = pl.locator('#actAtk')
            if not await atk.count() or await atk.is_disabled():
                await dm.click('#rdNext'); await dm.wait_for_timeout(900); continue
            await atk.click(); await pl.wait_for_timeout(400)
            go = pl.locator('.atk-go').first
            if not await go.count(): break
            await go.click(); await pl.wait_for_timeout(700)
            for _ in range(6):
                for t in json.loads(await pr.evaluate("JSON.stringify(window.__fx())"))['texts']: saw.add(t)
                await pr.wait_for_timeout(150)
            await shot(pr, 'proyector_ataque_%d' % rnd)
            if psql("select count(*) from tokens where id='%s'" % lobo) == '0':
                dead = True
                try: await pr.wait_for_function("window.__fx().nSkulls >= 1", timeout=4000)
                except Exception: print('   DEBUG', await pr.evaluate('JSON.stringify(window.__fx())'))
                sk = await pr.evaluate("window.__fx().nSkulls")
                check('Calavera al morir el lobo (proyector)', sk >= 1, str(sk))
                await shot(pr, 'proyector_muerte')
                break
            await dm.click('#rdNext'); await dm.wait_for_timeout(900)
        saw |= set(json.loads(await pr.evaluate("JSON.stringify(window.__fx())"))['allTexts'])
        check('Textos flotantes de combate (daño o fallo)', any(t.startswith('−') or t in ('Fallo', '¡Pifia!', '¡CRÍTICO!') for t in saw), str(saw))
        check('El lobo acaba muerto', dead)
        # narración
        await dm.click('#btnNarrate'); await dm.wait_for_timeout(200)
        await dm.fill('#nrTitle', 'La puerta del santuario')
        await dm.fill('#nrInput', 'Al empujar la puerta, una corriente helada apaga vuestras antorchas. En la oscuridad, algo respira despacio.')
        await dm.click('#nrSend'); await dm.wait_for_timeout(900)
        for who, pg in (('jugador', pl), ('proyector', pr), ('móvil', mo)):
            op = await pg.evaluate("document.getElementById('narration').classList.contains('open')")
            check('Pergamino visible en ' + who, op)
        await shot(pr, 'proyector_narracion'); await shot(mo, 'movil_narracion')
        await dm.click('#nrRetire'); await dm.wait_for_timeout(800)
        op = await pr.evaluate("document.getElementById('narration').classList.contains('open')")
        check('«Retirar para todos» lo cierra en el proyector', not op)
        # cambio de escena: importar otro mapa (se activa)
        await dm.click('#tabMapsBtn'); await dm.click('#btnImport')
        await dm.set_input_files('#fileInput', ['/tmp/vttest/uv.dd2vtt']); await dm.wait_for_timeout(600)
        await dm.click('#impCreate'); await dm.wait_for_function("!document.getElementById('importModal').classList.contains('open')", timeout=15000)
        await pr.wait_for_timeout(700)
        sc = await pr.evaluate("[document.getElementById('sceneCard').className, document.querySelector('#sceneCard .sc-t').textContent]")
        check('Cartel de cambio de escena con el nombre del mapa', 'show' in sc[0] and sc[1], str(sc))
        await shot(pr, 'proyector_escena')
        vis = await pl.evaluate("getComputedStyle(document.getElementById('fxLayer')).display")
        check('El mapa nuevo sin clima quita la lluvia', vis == 'none', vis)
        # modo inmersivo
        await pl.wait_for_timeout(2500)
        await pl.click('#btnImmersive'); await pl.wait_for_timeout(500)
        st = await pl.evaluate("[document.body.classList.contains('immersive'), getComputedStyle(document.querySelector('header')).display, getComputedStyle(document.getElementById('immBar')).display]")
        check('Modo inmersivo: sin cabecera ni panel, con barra de acciones', st == [True, 'none', 'flex'], str(st))
        await shot(pl, 'jugador_inmersivo')
        await pl.keyboard.press('Escape'); await pl.wait_for_timeout(300)
        check('Esc sale del modo inmersivo', not await pl.evaluate("document.body.classList.contains('immersive')"))
        # ficha con vial
        await pl.click('#tabPjBtn'); await pl.wait_for_timeout(300)
        check('Ficha con vial de PV', await pl.locator('#panel .vial').count() == 1)
        await shot(pl, 'jugador_ficha')
        await shot(dm, 'dm_final')
        for who, pg in (('DM', dm), ('Jugador', pl), ('Proyector', pr), ('Móvil', mo)):
            errs = [e for e in pg.errs if 'favicon' not in e and '404 (File not found)' not in e]
            check('Sin errores JS en ' + who, not errs, ' | '.join(errs[:4]))
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
