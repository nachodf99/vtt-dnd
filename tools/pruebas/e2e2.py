import asyncio, json, time
from playwright.async_api import async_playwright

src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'e2e.py')).read().split('async def main(step):')[0]
ns = {}; exec(src, ns)
psql, check, new_client, wait_loaded, map_to_screen, dump, results, APP = ns['psql'], ns['check'], ns['new_client'], ns['wait_loaded'], ns['map_to_screen'], ns['dump'], ns['results'], ns['APP']

async def import_map(dm, files):
    await dm.click('#tabMapsBtn'); await dm.click('#btnImport')
    await dm.set_input_files('#fileInput', files)
    await dm.wait_for_timeout(700)
    info = await dm.inner_text('#importInfo')
    await dm.click('#impCreate')
    await dm.wait_for_function("!document.getElementById('importModal').classList.contains('open')", timeout=30000)
    await dm.wait_for_timeout(800)
    return info

async def main():
    psql("truncate games, maps, tokens, rolls, templates, explored, game_members, game_secrets, join_attempts, profiles cascade; delete from storage.objects; delete from auth.users;")
    async with async_playwright() as p:
        # SIN la bandera de autoplay: el navegador bloquea el audio hasta que se toca la página
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-proxy-server'])
        dctx, dm = await new_client(br, 'Nacho DM')
        await dm.goto(APP); await wait_loaded(dm)
        await dm.wait_for_selector('#lobby.open', timeout=15000)
        await dm.uncheck('#newGamePriv') if await dm.is_checked('#newGamePriv') else None
        await dm.fill('#newGameName', 'Prueba 2'); await dm.click('#btnCreateGame')
        await dm.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=15000)
        gid = psql("select id from games limit 1")

        # --- UVTT con luces ---
        info = await import_map(dm, ['/tmp/vttest/uv.dd2vtt'])
        check('UVTT: importa 2 luces y la puerta', '2 luces' in info and '1 puertas' in info, info.replace('\n', ' '))
        m = json.loads(psql("select data from maps where data->>'name' like 'Mapa UVTT%' or data->>'name'='uv'") or '{}')
        ls = m.get('lights', [])
        check('UVTT: posición y radio de luz correctos', ls and ls[0]['x'] == 175 and ls[0]['dim'] == 4 and ls[0]['bright'] == 2 and ls[0]['color'] == '#ff9933', str(ls[:1]))
        check('UVTT: color ARGB → #rrggbb', len(ls) > 1 and ls[1]['color'] == '#66aaff', str(ls[1:2]))

        # --- PJ con antorcha: el servidor recalcula la CA y no debe borrar la luz ---
        await dm.click('#tabs button[data-tab=tokens]')
        await dm.click('#btnNewToken'); await dm.wait_for_timeout(300)
        await dm.fill('#tkName', 'Borin'); await dm.select_option('#tkType', 'pc'); await dm.select_option('#tkRace', 'Enano')
        await dm.select_option('#tkLight', 'torch'); await dm.fill('#tkDv', '')
        await dm.click('#tkSave')
        await dm.wait_for_function("!document.getElementById('tokenModal').classList.contains('open')", timeout=15000)
        await dm.wait_for_timeout(1200)
        t = json.loads(psql("select data from tokens where data->>'name'='Borin'"))
        check('Antorcha guardada tras token_recalc', t.get('lightKind') == 'torch' and t.get('lightDim') == 8 and t.get('lightBright') == 4, '%s %s' % (t.get('lightKind'), t.get('lightDim')))
        check('Visión en la oscuridad vacía = según raza (null)', t.get('darkvision') is None, str(t.get('darkvision')))
        # reabrir el modal: conserva los valores
        await dm.click('.t-edit'); await dm.wait_for_timeout(300)
        lv = await dm.input_value('#tkLight'); dv = await dm.input_value('#tkDv')
        check('El formulario muestra la antorcha al editar', lv == 'torch' and dv == '', '%s/%s' % (lv, dv))
        await dm.select_option('#tkLight', ''); await dm.fill('#tkDv', '3'); await dm.click('#tkSave')
        await dm.wait_for_function("!document.getElementById('tokenModal').classList.contains('open')", timeout=15000)
        await dm.wait_for_timeout(1000)
        t = json.loads(psql("select data from tokens where data->>'name'='Borin'"))
        check('Quitar la antorcha y poner 3 casillas de visión', not t.get('lightKind') and not t.get('lightDim') and t.get('darkvision') == 3, '%s %s' % (t.get('lightKind'), t.get('darkvision')))

        # --- jugador sin autoplay ---
        pctx, pl = await new_client(br, 'Laura')
        await pl.goto(APP + '?unirse=' + gid); await wait_loaded(pl)
        await pl.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=20000)
        await pl.click('#tabPjBtn'); await pl.wait_for_timeout(400); await pl.click('.t-claim'); await pl.wait_for_timeout(1200)
        # el DM sube y pone música
        await dm.click('#tabAudioBtn'); await dm.wait_for_timeout(300)
        await dm.select_option('#audKind', 'amb')
        await dm.set_input_files('#audFile', ['/tmp/vttest/tone.wav']); await dm.wait_for_timeout(1500)
        await dm.click('.aud-toggle'); await dm.wait_for_timeout(2000)
        # jugador que entra y no toca nada: el navegador bloquea el audio
        brq = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-proxy-server', '--autoplay-policy=user-gesture-required'])
        qctx, q = await new_client(brq, 'Quieto')
        await qctx.add_init_script("""(() => { const op = HTMLMediaElement.prototype.play; let act = false;
          ['pointerdown','keydown','click'].forEach(ev => window.addEventListener(ev, () => { act = true; }, true));
          HTMLMediaElement.prototype.play = function(){ if (!act) return Promise.reject(new DOMException('bloqueado', 'NotAllowedError')); return op.call(this); }; })();""")
        await q.goto(APP + '?unirse=' + gid); await wait_loaded(q)
        await q.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=20000)
        await q.wait_for_timeout(1500)
        btn = await q.inner_text('#btnAudio'); st = await q.evaluate("window.__audios.map(a => a.paused)")
        print('   debug', await q.evaluate("[navigator.userActivation.hasBeenActive, HTMLMediaElement.prototype.play.toString().slice(0,60), window.__audios.length]"))
        check('Sin interacción: el jugador ve «Activar sonido»', 'Activar sonido' in btn and st == [True], '%s %s' % (btn, st))
        await q.click('#btnAudio'); await q.wait_for_timeout(800)
        st = await q.evaluate("window.__audios.map(a => a.paused)"); btn = await q.inner_text('#btnAudio')
        check('Al tocarlo empieza a sonar', st == [False] and btn.strip() == '🔊', '%s %s' % (st, btn))
        await brq.close()
        # ambiente: se pueden mezclar dos pistas; música: solo una
        await dm.set_input_files('#audFile', ['/tmp/vttest/tone.wav']); await dm.wait_for_timeout(1500)
        await dm.locator('.aud-toggle').nth(1).click(); await dm.wait_for_timeout(1500)
        n = await pl.evaluate("window.__audios.filter(a => !a.paused).length")
        check('Dos ambientes suenan a la vez', n == 2, str(n))
        await dm.select_option('#audKind', 'music')
        await dm.set_input_files('#audFile', ['/tmp/vttest/tone.wav', '/tmp/vttest/tone.wav']); await dm.wait_for_timeout(2000)
        trks = await dm.evaluate("[...document.querySelectorAll('.trk .aud-toggle')].length")
        check('4 pistas en la lista (2 ambiente + 2 música)', trks == 4, str(trks))
        await dm.locator('.aud-toggle').nth(0).click(); await dm.wait_for_timeout(800)
        await dm.locator('.aud-toggle').nth(1).click(); await dm.wait_for_timeout(1500)
        ga = json.loads(psql("select data->'audio' from games where id='%s'" % gid))
        kinds = sorted(next(t['kind'] for t in ga['tracks'] if t['id'] == k) for k in ga['play'])
        check('Música: al poner otra se quita la anterior (ambientes siguen)', kinds == ['amb', 'amb', 'music'], str(kinds))
        # volumen por pista sincronizado
        await dm.locator('.aud-vol').nth(2).fill('20'); await dm.locator('.aud-vol').nth(2).dispatch_event('change'); await dm.wait_for_timeout(1500)
        vols = await pl.evaluate("window.__audios.filter(a => !a.paused).map(a => Math.round(a.volume * 100))")
        check('Volumen de una pista llega al jugador (20% × 80% local = 16%)', 16 in vols, str(vols))
        # borrar pista en reproducción
        dl = dm.locator('.trk.on .aud-del').nth(0); await dl.click(); await dl.click(); await dm.wait_for_timeout(1500)
        n = await pl.evaluate("window.__audios.filter(a => !a.paused).length")
        check('Borrar una pista que sonaba la detiene', n == 2, str(n))
        await dm.click('#audStopAll'); await dm.wait_for_timeout(1000)

        # --- proyector: no reproduce audio ---
        await dm.locator('.aud-toggle').nth(0).click(); await dm.wait_for_timeout(500)
        prctx, pr = await new_client(br, 'Nacho DM', state=await dctx.storage_state())   # misma sesión que el DM
        await pr.goto(APP + '?proyector=' + gid); await wait_loaded(pr); await pr.wait_for_timeout(3000)
        joined = await pr.evaluate("!!document.getElementById('gameBadge').textContent")
        check('El proyector entra en la partida', joined)
        st = await pr.evaluate("window.__audios.length")
        check('El proyector no reproduce audio (evita sonido doble)', st == 0, str(st))
        await dm.click('#audStopAll'); await dm.wait_for_timeout(500)

        # --- la regla se borra al cambiar de mapa ---
        await pl.click('#btnRuler')
        a = await map_to_screen(pl, 100, 100); b = await map_to_screen(pl, 300, 100)
        await pl.mouse.click(*a); await pl.mouse.click(*b); await pl.wait_for_timeout(400)
        rr = await dm.evaluate("window.__rulers()")
        info = await import_map(dm, ['/tmp/vttest/map.json', '/tmp/vttest/map.png'])   # activa otro mapa
        await pl.wait_for_timeout(1500)
        rr2 = await dm.evaluate("window.__rulers()")
        tot = await pl.inner_text('#rulerTotal')
        check('Al cambiar de mapa la regla en curso se borra (y para el DM)', rr and rr2 == [] and 'Toca el mapa' in tot, '%s → %s / %s' % (rr, rr2, tot))
        await pl.click('#rulerExit')
        # proyector ve la regla del DM
        await dm.click('#btnRuler')
        a = await map_to_screen(dm, 150, 150); b = await map_to_screen(dm, 350, 350)
        await dm.mouse.click(*a); await dm.mouse.click(*b); await dm.wait_for_timeout(700)
        rp = await pr.evaluate("window.__rulers()")
        check('El proyector muestra la regla del DM', rp and rp[0]['n'] == 2, str(rp))
        if not rp:
            import subprocess
            print(subprocess.run("grep 'WS <-' /tmp/mock.log | grep -v heartbeat | tail -25", shell=True, capture_output=True, text=True).stdout)
            print('   proj state', await pr.evaluate("[document.getElementById('gameBadge').textContent, window.__cam()]"))
        await dm.click('#rulerExit')

        # --- reinicio de explorado con reloj desfasado del jugador ---
        mid = psql("select data->>'activeMapId' from games where id='%s'" % gid)
        borin = psql("select id from tokens where data->>'name'='Borin'")
        psql("update tokens set data = data || jsonb_build_object('mapId','%s','x',1050,'y',450) where id='%s'" % (mid, borin))
        await pl.wait_for_timeout(5500)
        await dm.click('#tabMapsBtn'); await dm.wait_for_timeout(300)
        await dm.click('#resetExplored'); await dm.click('#resetExplored'); await dm.wait_for_timeout(1200)
        await pl.evaluate("Date.now = (() => { const o = Date.now; return () => o() - 10 * 60 * 1000; })()")   # 10 min atrasado
        psql("update tokens set data = data || '{\"x\":150,\"y\":450}' where id='%s'" % borin)
        await pl.wait_for_timeout(5500)
        before = await pl.evaluate("window.__expPixels()")
        await pl.reload(); await wait_loaded(pl)
        await pl.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=20000)
        await pl.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('vtt_exp_')).forEach(k=>localStorage.removeItem(k))")
        await pl.reload(); await wait_loaded(pl)
        await pl.wait_for_function("document.getElementById('gameBadge').style.display !== 'none'", timeout=20000)
        await pl.wait_for_timeout(2500)
        after = await pl.evaluate("window.__expPixels()")
        check('Con el reloj atrasado no se pierde lo explorado tras un reinicio', after >= before * 0.9 and before > 0, '%s → %s' % (before, after))

        # --- rendimiento: mapa grande con 80 luces y 600 muros ---
        info = await import_map(dm, ['/tmp/vttest/big.json', '/tmp/vttest/big.png'])
        mid = psql("select data->>'activeMapId' from games where id='%s'" % gid)
        psql("update tokens set data = data || jsonb_build_object('mapId','%s','x',2050,'y',1450) where id='%s'" % (mid, borin))
        await pl.wait_for_timeout(2500)
        for pg_ in (dm, pl, pr): await pg_.evaluate("window.__pauseFx(true)")   # medir sin el parpadeo de las otras ventanas
        await pl.wait_for_timeout(300)
        ms = await pl.evaluate("(() => { const t0 = performance.now(); for (let i = 0; i < 5; i++) window.__recompute(); return (performance.now() - t0) / 5; })()")
        msl = await pl.evaluate("(() => { window.__resetLightCache(); const t0 = performance.now(); window.__recompute(); return performance.now() - t0; })()")
        check('Recalcular niebla+luces en mapa grande < 60 ms (con luces en caché)', ms < 60, '%.1f ms (primera vez con 80 luces: %.0f ms)' % (ms, msl))
        for pg_ in (dm, pl, pr): await pg_.evaluate("window.__pauseFx(false)")
        await pl.screenshot(path='/tmp/e2e2_big.png')

        for who, pg in (('DM', dm), ('Jugador', pl), ('Proyector', pr)):
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
