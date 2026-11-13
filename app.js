// Mesa de Rol — VTT · lógica de la aplicación
import { createClient } from '/vendor/supabase.js';

/* ============ utilidades ============ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now());
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg, err){
  const box = $('#toasts');
  // no repetir el mismo aviso si aún se ve; y como mucho 3 a la vez
  if ([...box.children].some(x => x.textContent === msg)) return;
  while (box.children.length >= 3) box.firstChild.remove();
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  t.setAttribute('role', err ? 'alert' : 'status');
  t.onclick = () => t.remove();
  box.appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3600);
}
function snapDocs(snap){
  if (!snap) return [];
  if (Array.isArray(snap)) return snap.map(d => ({ id: d.id, ...(typeof d.data === 'function' ? (d.data() || {}) : (d.data || d)) }));
  if (snap.docs) return snap.docs.map(d => ({ id: d.id, ...(typeof d.data === 'function' ? (d.data() || {}) : (d.data || {})) }));
  return [];
}
function armConfirm(btn, fn){
  if (btn.dataset.armed){ btn.dataset.armed = ''; fn(); return; }
  btn.dataset.armed = '1';
  const old = btn.textContent; btn.textContent = '¿Seguro?'; btn.classList.add('danger');
  setTimeout(() => { if (btn.isConnected){ btn.dataset.armed = ''; btn.textContent = old; } }, 2600);
}
function lsGet(k){ try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch(e){ return null; } }
function lsSet(k, v){ try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }

/* ============ estado global ============ */
let SB = null, DB = null, GCH = null;
const S = {
  uid: 'local', isDM: false, viewAsPlayer: false, localMode: false,
  games: {}, gameId: null, lobbyManual: false,
  maps: {}, tokens: {}, rolls: [],
  activeMapId: null,
  media: { mapId: null, img: null, video: null, w: 0, h: 0 },
  cam: { x: 40, y: 40, s: 0.4 },
  tab: 'tokens', showGrid: true, showWalls: false,
  projector: new URLSearchParams(location.search).get('proyector') || null,
  syncProjector: true, projectorOpen: false,
  join: new URLSearchParams(location.search).get('unirse') || null,
  joinCode: (new URLSearchParams(location.search).get('c') || '').slice(0, 12) || null,
  lobbyGames: [], gameCode: null, user: null, joinTried: false, mapsOther: false,
  phone: false, attackPick: false, invSel: null, reach: [], busy: false, tkInv: null,
  attacks: [], atkSel: null, lastLevel: {}, lastHp: {},
  items: [], itemById: {}, itemTarget: null, recalcAsked: {},
  drag: null, pan: null, pings: [], peers: [],
  visPolys: [], visInfo: [], lights: [], needLight: false, fogDirty: true, explored: {},
  templates: [], tplMode: false, tplShape: 'circle', tplDraft: null,
  rulerMode: false, ruler: null, rulers: {},
  editingToken: null, pendingImport: null,
  tkImgBlob: null, tkImgClear: false,
};
const EXPLORED_SCALE = 0.25;
const CONDS = ['Agarrado','Asustado','Aturdido','Cegado','Derribado','Encantado','Ensordecido','Envenenado','Incapacitado','Inconsciente','Invisible','Paralizado','Petrificado','Apresado','Concentración'];
const CLASSES = {
  guerrero:   { n: 'Guerrero',   ac: 16, atk: 5, dmg: '1d8+3',  range: 1, move: '1d6'   },
  barbaro:    { n: 'Bárbaro',    ac: 14, atk: 5, dmg: '1d12+3', range: 1, move: '1d6+1' },
  paladin:    { n: 'Paladín',    ac: 18, atk: 5, dmg: '1d8+3',  range: 1, move: '1d6'   },
  monje:      { n: 'Monje',      ac: 15, atk: 5, dmg: '1d6+3',  range: 1, move: '1d8'   },
  picaro:     { n: 'Pícaro',     ac: 14, atk: 5, dmg: '1d6+3',  range: 6, move: '1d8'   },
  explorador: { n: 'Explorador', ac: 15, atk: 5, dmg: '1d8+3',  range: 8, move: '1d8'   },
  clerigo:    { n: 'Clérigo',    ac: 16, atk: 4, dmg: '1d8+2',  range: 1, move: '1d6'   },
  druida:     { n: 'Druida',     ac: 14, atk: 4, dmg: '1d8',    range: 4, move: '1d6'   },
  bardo:      { n: 'Bardo',      ac: 13, atk: 4, dmg: '1d6+2',  range: 6, move: '1d6'   },
  brujo:      { n: 'Brujo',      ac: 13, atk: 5, dmg: '1d10+3', range: 8, move: '1d6'   },
  hechicero:  { n: 'Hechicero',  ac: 12, atk: 5, dmg: '1d10',   range: 8, move: '1d6'   },
  mago:       { n: 'Mago',       ac: 12, atk: 5, dmg: '1d10',   range: 8, move: '1d6'   },
};
const RACES = ['Humano','Elfo','Enano','Mediano','Gnomo','Semielfo','Semiorco','Dracónido','Tiflin'];
const XP_LEVELS = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500];
function levelFor(xp){ let l = 1; for (let i = 1; i < XP_LEVELS.length; i++) if ((xp || 0) >= XP_LEVELS[i]) l = i + 1; return l; }
function levelOf(t){ return Math.max(t.level || 1, levelFor(t.xp || 0)); }
const ABILS = [['str','FUE'],['dex','DES'],['con','CON'],['int','INT'],['wis','SAB'],['cha','CAR']];
const CLASS_ABIL = {
  guerrero:{str:15,dex:13,con:14,int:8,wis:12,cha:10}, barbaro:{str:15,dex:13,con:14,int:8,wis:12,cha:10},
  paladin:{str:15,dex:10,con:13,int:8,wis:12,cha:14}, monje:{str:12,dex:15,con:13,int:10,wis:14,cha:8},
  picaro:{str:8,dex:15,con:13,int:14,wis:12,cha:10}, explorador:{str:12,dex:15,con:13,int:8,wis:14,cha:10},
  clerigo:{str:13,dex:12,con:14,int:8,wis:15,cha:10}, druida:{str:8,dex:13,con:14,int:12,wis:15,cha:10},
  bardo:{str:8,dex:14,con:13,int:12,wis:10,cha:15}, brujo:{str:8,dex:14,con:13,int:12,wis:10,cha:15},
  hechicero:{str:8,dex:13,con:14,int:10,wis:12,cha:15}, mago:{str:8,dex:13,con:14,int:15,wis:12,cha:10}
};
const SLOT_LABEL = { armor: 'Armadura', shield: 'Escudo', weapon: 'Arma', acc: 'Accesorio' };
function abMod(v){ const m = Math.floor(((v || 10) - 10) / 2); return (m >= 0 ? '+' : '') + m; }
const CTYPES = ['Aberración','Bestia','Celestial','Cieno','Constructo','Dragón','Elemental','Feérico','Gigante','Humanoide','Infernal','Monstruosidad','No muerto','Planta'];
const ACTION_LABEL = { move: 'Movimiento', attack: 'Ataque', pass: 'Pasó turno' };
function raceCls(t){ return [t.race, (CLASSES[t.cls] || {}).n].filter(Boolean).join(' · ') || 'Sin clase'; }
const COLORS = ['#8c2b2b','#3d6b8f','#4e8c4a','#8a6d1d','#6b3f8f','#b4632e','#2e8f8a','#8f2e6b'];

function myName(){ return (lsGet('vtt_name') || '').trim() || 'Aventurero'; }

/* ============ shim local (sin conexión) ============ */
function makeLocalDB(){
  const store = {}; const subs = [];
  function notify(){ subs.forEach(s => { try { s.fn(s.get()); } catch(e){} }); }
  function docRef(path){
    return {
      set(v){ store[path] = JSON.parse(JSON.stringify(v)); notify(); return Promise.resolve(); },
      update(v){ store[path] = Object.assign(store[path] || {}, JSON.parse(JSON.stringify(v))); notify(); return Promise.resolve(); },
      delete(){ delete store[path]; notify(); return Promise.resolve(); },
      get(){ const p = path; return Promise.resolve({ exists: !!store[p], data: () => store[p] }); },
      onSnapshot(fn){ const s = { fn, get: () => ({ exists: !!store[path], data: () => store[path] }) }; subs.push(s); setTimeout(() => s.fn(s.get()), 0); return () => {}; }
    };
  }
  function colRef(col){
    const q = {
      orderBy(){ return q; }, limit(){ return q; }, where(){ return q; },
      doc(id){ return docRef(col + '/' + id); },
      onSnapshot(fn){
        const s = { fn, get: () => Object.keys(store).filter(k => k.startsWith(col + '/') && k.split('/').length === 2).map(k => ({ id: k.split('/')[1], data: () => store[k] })) };
        subs.push(s); setTimeout(() => s.fn(s.get()), 0); return () => {};
      }
    };
    return q;
  }
  return { doc: docRef, collection: colRef, reload(){ return Promise.resolve(); } };
}

/* ============ saneado de datos recibidos (defensa contra XSS de otros usuarios) ============ */
const NUM_KEYS = { tokens: ['hp','hpMax','ac','atk','range','x','y','size','vision','xp','level','pb','attuned','save','acMisc','lightBright','lightDim'], rolls: ['total','ts'], maps: ['grid','w','h','gridOffX','gridOffY','wallOffX','wallOffY','defaultVision','createdAt','darkness','lightScale','exploredReset'], games: ['createdAt'], templates: ['x','y','angle','len','dx','dy','ts'] };
const HEX_RE = /^#[0-9a-f]{3,8}$/i;
// URLs de recursos aceptadas (https; en local también http://localhost para el servidor de pruebas)
const DEV_HOST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const ASSET_RE = DEV_HOST ? /^(https:\/\/|blob:|http:\/\/(localhost|127\.0\.0\.1)[:/])/i : /^(https:\/\/|blob:)/i;
const IMG_RE = DEV_HOST ? /^(https:\/\/|blob:|data:image\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/i : /^(https:\/\/|blob:|data:image\/)/i;
const num0 = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function cleanDoc(t, d){
  if (!d || typeof d !== 'object') return d;
  (NUM_KEYS[t] || []).forEach(k => { if (d[k] != null && typeof d[k] !== 'number'){ const n = Number(d[k]); d[k] = Number.isFinite(n) ? n : 0; } });
  if (t === 'tokens'){
    if (d.color != null && !/^#[0-9a-f]{3,8}$/i.test(String(d.color))) d.color = '#777777';
    if (d.imgUrl && !IMG_RE.test(String(d.imgUrl))) d.imgUrl = null;
    if (d.inventory && Array.isArray(d.inventory.items)) d.inventory.items.forEach(it => { if (it && typeof it.qty !== 'number') it.qty = Number(it.qty) || 1; });
  }
  if (t === 'maps' && d.assetUrl && !ASSET_RE.test(String(d.assetUrl))) d.assetUrl = '';
  if (t === 'maps' && d.lights != null){
    d.lights = Array.isArray(d.lights) ? d.lights.slice(0, 500).filter(l => l && typeof l === 'object').map(l => ({
      x: num0(l.x), y: num0(l.y), bright: Math.max(0, num0(l.bright)), dim: Math.max(0, num0(l.dim)),
      color: HEX_RE.test(String(l.color || '')) ? l.color : '#ffb35c', alpha: clamp(l.alpha == null ? 0.5 : num0(l.alpha), 0, 1)
    })) : [];
  }
  if (t === 'tokens'){
    if (d.darkvision != null && d.darkvision !== '') d.darkvision = Math.max(0, num0(d.darkvision));
    if (d.lightColor != null && !HEX_RE.test(String(d.lightColor))) d.lightColor = '#ff9b42';
  }
  if (t === 'templates'){
    if (!['circle', 'cone', 'line', 'cube'].includes(d.shape)) d.shape = 'circle';
    if (!HEX_RE.test(String(d.color || ''))) d.color = '#c9a227';
    d.name = String(d.name || '').slice(0, 40);
  }
  if (t === 'games' && d.audio && typeof d.audio === 'object'){
    const a = d.audio;
    a.tracks = Array.isArray(a.tracks) ? a.tracks.slice(0, 80).filter(x => x && x.id && ASSET_RE.test(String(x.url || ''))).map(x => ({
      id: String(x.id).slice(0, 60), name: String(x.name || 'Pista').slice(0, 80), url: String(x.url),
      kind: x.kind === 'amb' ? 'amb' : 'music', vol: clamp(x.vol == null ? 0.7 : num0(x.vol), 0, 1), loop: x.loop !== false
    })) : [];
    const pl = {}; if (a.play && typeof a.play === 'object') Object.keys(a.play).slice(0, 20).forEach(k => { const v = a.play[k] || {}; pl[k] = { at: num0(v.at), vol: clamp(v.vol == null ? 0.7 : num0(v.vol), 0, 1) }; });
    a.play = pl;
  }
  if (t === 'games' && d.round && typeof d.round.n !== 'number') d.round.n = Number(d.round.n) || 1;
  return d;
}

/* ============ adaptador Supabase (tablas jsonb + realtime) ============ */
function makeSupaDB(){
  const tables = ['games', 'maps', 'tokens', 'rolls', 'templates'];
  const extra = ['templates'];   // tablas nuevas: canal aparte para que, si faltan en la BD, no rompan el resto
  const cache = {}; const colSubs = {}; const docSubs = {};
  tables.forEach(t => { cache[t] = new Map(); colSubs[t] = []; docSubs[t] = []; });
  function notify(t){
    const arr = [...cache[t].entries()].map(([id, data]) => ({ id, data }));
    colSubs[t].forEach(fn => { try { fn(arr); } catch(e){} });
    docSubs[t].forEach(l => { const d = cache[t].get(l.id); try { l.fn({ exists: d != null, data: () => d }); } catch(e){} });
  }
  async function loadAll(t){
    const { data, error } = await SB.from(t).select('id,data');
    if (!error && data){ cache[t].clear(); data.forEach(r => cache[t].set(r.id, cleanDoc(t, r.data))); notify(t); }
    else if (error) console.warn('load', t, error.message);
  }
  const ch = SB.channel('db-changes');
  const chX = SB.channel('db-changes-extra');
  tables.forEach(t => {
    const ch0 = extra.includes(t) ? chX : ch;
    ch0.on('postgres_changes', { event: '*', schema: 'public', table: t }, payload => {
      if (payload.eventType === 'DELETE'){ if (payload.old && payload.old.id != null) cache[t].delete(payload.old.id); }
      else if (payload.new && payload.new.id != null){ cache[t].set(payload.new.id, cleanDoc(t, payload.new.data)); }
      notify(t);
    });
  });
  let reloaded = false;
  ch.subscribe(status => { if (status === 'SUBSCRIBED' && !reloaded){ reloaded = true; tables.forEach(loadAll); } });
  chX.subscribe(status => { if (status === 'SUBSCRIBED') extra.forEach(loadAll); });
  tables.forEach(loadAll);
  function split(path){ const i = path.indexOf('/'); return { t: path.slice(0, i), id: path.slice(i + 1) }; }
  function hiddenNow(t, id, v){
    if (t !== 'tokens' || !S.isDM || !GCH) return;
    const prev = cache[t].get(id);
    if (v && v.hidden && !(prev && prev.hidden)) setTimeout(() => { try { GCH.send({ type: 'broadcast', event: 'tok-refresh', payload: {} }); } catch(e){} }, 300);
  }
  // Si el documento ya existe, ACTUALIZAR (no "insertar o actualizar"): las partidas solo se crean
  // con la función create_game y la base de datos no permite insertarlas directamente.
  async function write(t, id, v){
    if (cache[t].has(id) || t === 'games'){
      const r = await SB.from(t).update({ data: v }).eq('id', id).select('id');
      if (r.error) return r;
      if (r.data && r.data.length) return r;
      if (t === 'games') return { error: { message: 'No tienes permiso para modificar esta partida' } };
    }
    return SB.from(t).upsert({ id, data: v });
  }
  const api = {
    reload(list){ return Promise.all((list || tables).map(loadAll)); },
    doc(path){
      const { t, id } = split(path);
      return {
        async set(v){
          const { error } = await write(t, id, v);
          if (error) throw new Error(error.message);
          hiddenNow(t, id, v);
          cache[t].set(id, v); notify(t);
        },
        async update(v){
          const cur = cache[t].get(id) || {};
          const nv = Object.assign({}, cur, v);
          const { error } = await write(t, id, nv);
          if (error) throw new Error(error.message);
          hiddenNow(t, id, nv);
          cache[t].set(id, nv); notify(t);
        },
        async delete(){
          const { error } = await SB.from(t).delete().eq('id', id);
          if (error) throw new Error(error.message);
          cache[t].delete(id); notify(t);
        },
        get(){ const d = cache[t].get(id); return Promise.resolve({ exists: d != null, data: () => d }); },
        onSnapshot(fn){ docSubs[t].push({ id, fn }); const d = cache[t].get(id); setTimeout(() => fn({ exists: d != null, data: () => d }), 0); return () => {}; }
      };
    },
    collection(t){
      const q = {
        orderBy(){ return q; }, limit(){ return q; }, where(){ return q; },
        doc(id){ return api.doc(t + '/' + id); },
        onSnapshot(fn){ colSubs[t].push(fn); setTimeout(() => notify(t), 0); return () => {}; }
      };
      return q;
    }
  };
  return api;
}
async function uploadAsset(blob){
  const ext = (blob.type && blob.type.split('/')[1]) ? blob.type.split('/')[1].replace('+xml', '') : 'bin';
  const path = S.uid + '/' + uuid() + '.' + ext;
  const { error } = await SB.storage.from('assets').upload(path, blob, { contentType: blob.type || undefined });
  if (error) throw new Error(error.message);
  const { data } = SB.storage.from('assets').getPublicUrl(path);
  return { url: data.publicUrl };
}

/* ============ arranque ============ */
let loadingDone = false;
function finishLoading(){ if (!loadingDone){ loadingDone = true; $('#loading').style.display = 'none'; } }
setTimeout(() => {
  if (!loadingDone){
    if (!DB){ enterLocalMode('No se pudo conectar. Modo local: los cambios no se comparten ni se guardan.'); }
    finishLoading();
  }
}, 12000);

function enterLocalMode(msg){
  S.localMode = true;
  DB = makeLocalDB();
  const b = $('#banner'); b.style.display = 'block'; b.textContent = '⚠ ' + msg;
  startSubscriptions(); finishLoading(); showLobby();
  DB.doc('games/local').set({ name: 'Partida local', code: null, dmId: S.uid, activeMapId: null, combat: { active: false, round: 1, turn: 0, entries: [] }, createdAt: Date.now() });
  joinGame('local', true);
}

async function getConfig(){
  try {
    const r = await fetch('/api/config');
    if (r.ok){
      const c = await r.json();
      if (c && c.url && c.anon) return c;
    }
  } catch(e){}
  if (window.VTT_CONFIG && window.VTT_CONFIG.url) return window.VTT_CONFIG;
  throw new Error('Sin configuración de Supabase (ni /api/config ni config.local.js)');
}

(async function boot(){
  try {
    const cfg = await getConfig();
    S.cfg = cfg;
    SB = createClient(cfg.url, cfg.anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    authUrlErrors();
    let session = (await SB.auth.getSession()).data.session;
    if (!session){
      const r = await SB.auth.signInAnonymously();
      if (r.error) throw new Error(r.error.message + ' (¿está activado el acceso anónimo en Supabase Auth?)');
      session = r.data.session;
    }
    S.uid = session.user.id;
    S.user = session.user;
    SB.auth.onAuthStateChange((ev, ses) => {
      if (ev === 'PASSWORD_RECOVERY'){ S.user = ses && ses.user; openAuth('newpw'); return; }
      if (ses && ses.user){
        if (ses.user.id !== S.uid){ location.replace(location.origin + location.pathname); return; }
        S.user = ses.user; renderAccount(); maybeNeedPassword();
      }
    });
    loadProfile();
    DB = makeSupaDB();
    SB.from('items').select('*').then(({ data }) => {
      S.items = (data || []).sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
      S.itemById = {}; S.items.forEach(i => { S.itemById[i.id] = i; });
      $('#itemList').innerHTML = S.items.map(i => '<option value="' + esc(i.name) + '">' + esc(i.cat + (i.rarity ? ' · ' + i.rarity : '') + (i.fx && i.fx.t !== 'note' ? ' · ⚡ automático' : '') + ' · ' + (i.en || '')) + '</option>').join('');
      renderPanel();
    });
    SB.from('attacks').select('*').then(({ data }) => { S.attacks = (data || []).sort((a, b) => a.lvl - b.lvl || a.name.localeCompare(b.name)); renderPanel(); });
    if (cfg.env && cfg.env !== 'production'){
      const eb = $('#envBadge'); eb.style.display = ''; eb.textContent = '🧪 ' + (cfg.env === 'preview' ? 'PREPRODUCCIÓN' : cfg.env.toUpperCase());
      document.title = '[PRE] Mesa de Rol — VTT';
    }
    startSubscriptions();
    showLobby();
    finishLoading();
  } catch(e){
    enterLocalMode('Error al conectar (' + (e && e.message ? e.message : e) + '). Modo local activado.');
  }
})();

function applyRole(){
  const rb = $('#roleBadge');
  if (!S.gameId){ rb.style.display = 'none'; }
  else {
    rb.style.display = '';
    rb.innerHTML = S.isDM ? '👑<span class="lbl"> Dungeon Master</span>' : '🛡<span class="lbl"> Jugador</span>';
    rb.title = S.isDM ? 'Eres el Dungeon Master' : 'Eres jugador';
    rb.className = 'badge' + (S.isDM ? ' dm' : '');
  }
  $('#btnViewAs').style.display = (S.isDM && S.gameId) ? '' : 'none';
  $('#tabPjBtn').style.display = (!S.isDM && S.gameId) ? '' : 'none';
  $('#btnQR').style.display = (S.isDM && S.gameId && !S.projector) ? '' : 'none';
  if (S.isDM && S.tab === 'pj') selectTab('tokens');
  $('#btnProjector').style.display = (S.isDM && S.gameId && !S.projector) ? '' : 'none';
  $('#btnSync').style.display = (S.isDM && S.gameId && !S.projector && S.projectorOpen) ? '' : 'none';
  $('#btnFog').style.display = S.isDM ? '' : 'none';
  $('#btnWalls').style.display = S.isDM ? '' : 'none';
  $('#btnSpawn').style.display = (S.isDM && !S.projector) ? '' : 'none';
  $('#tabMapsBtn').style.display = S.isDM ? '' : 'none';
  $('#emptyImportBtn').style.display = S.isDM ? '' : 'none';
  $('#emptyState .big').textContent = S.projector ? 'La aventura está a punto de comenzar' : 'No hay mapa activo';
  $('#emptyHint').textContent = S.projector ? 'Esperando a que el DM active un mapa…' : S.isDM
    ? 'Exporta tu mapa desde Dungeon Alchemist (formato Foundry o Universal VTT) e impórtalo aquí.'
    : 'El DM aún no ha activado ningún mapa. ¡Prepara tus dados!';
  renderPanel();
}

function updateProjTitle(){
  const el = $('#projTitle'); if (!el) return;
  const g = gameDoc();
  el.textContent = g ? (g.name || 'Partida') : 'Mesa de rol';
  el.classList.toggle('has-map', !!activeMap());
}
/* ============ partidas (lobby) ============ */
function gameDoc(){ return S.gameId ? (S.games[S.gameId] || null) : null; }
function showLobby(){
  if (S.projector){
    $('#emptyState').style.display = 'flex';
    $('#emptyState .big').textContent = 'Proyector esperando a la partida…';
    $('#emptyHint').textContent = 'Abre esta ventana desde el botón 📽 Proyector de la partida.';
    return;
  }
  $('#lobby').classList.add('open');
  $('#gameBadge').style.display = 'none';
  $('#btnLeave').style.display = 'none';
  $('#myName').value = (lsGet('vtt_name') || '');
  renderLobby(); refreshLobby();
}
$('#myName') && ($('#myName').onchange = e => { lsSet('vtt_name', e.target.value.trim()); saveProfileName(e.target.value); renderAccount(); });
/* ============ cuentas ============ */
const GOOGLE_SVG = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function isGuest(){ return !S.user || S.user.is_anonymous === true || !S.user.email; }
function redirectUrl(){ return location.origin + location.pathname; }
function authUrlErrors(){
  try {
    const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const err = q.get('error_description') || h.get('error_description');
    if (err){
      const msg = /already/i.test(err) ? 'Esa cuenta ya existe. Usa «Entrar» para iniciar sesión con ella.' : err;
      setTimeout(() => toast(msg, true), 800);
      history.replaceState(null, '', location.pathname + (S.join ? '?unirse=' + encodeURIComponent(S.join) + (S.joinCode ? '&c=' + encodeURIComponent(S.joinCode) : '') : ''));
    }
  } catch(e){}
}
async function loadProfile(){
  if (!SB || isGuest()) return;
  const { data } = await SB.from('profiles').select('display_name').eq('id', S.uid).maybeSingle();
  if (data && data.display_name){ if (!(lsGet('vtt_name') || '').trim()) lsSet('vtt_name', data.display_name); if ($('#myName')) $('#myName').value = lsGet('vtt_name') || ''; }
  else if ((lsGet('vtt_name') || '').trim()) saveProfileName(lsGet('vtt_name'));
  renderAccount();
}
function saveProfileName(name){
  if (!SB || isGuest()) return;
  SB.from('profiles').upsert({ id: S.uid, display_name: String(name || '').trim().slice(0, 40), updated_at: new Date().toISOString() }).then(() => {});
}
function renderAccount(){
  const card = $('#acctCard'); if (!card) return;
  if (S.localMode || !SB){ card.style.display = 'none'; return; }
  card.style.display = '';
  const guest = isGuest();
  const nm = (lsGet('vtt_name') || '').trim();
  $('#acctAv').textContent = guest ? '👤' : (nm || S.user.email || '?').charAt(0).toUpperCase();
  $('#acctName').textContent = guest ? 'Invitado' : (nm || S.user.email);
  $('#acctMail').textContent = guest ? (S.user && S.user.new_email ? 'Pendiente de confirmar: ' + S.user.new_email : 'Sin cuenta') : S.user.email;
  $('#acctBtns').innerHTML = guest
    ? '<button class="small" id="acctLogin">Entrar</button><button class="small primary" id="acctSignup">Crear cuenta</button>'
    : '<button class="small" id="acctProfile">👤 Perfil</button>';
  $('#acctNote').innerHTML = guest
    ? (S.user && S.user.new_email ? '📧 Revisa tu correo y pulsa el enlace para activar la cuenta.' : 'Como invitado, tus partidas y personajes solo están en este navegador. <b>Crea una cuenta</b> para usarlos desde cualquier dispositivo; no perderás nada de lo que ya tienes.')
    : '';
  const a = $('#acctLogin'); if (a) a.onclick = () => openAuth('login');
  const b = $('#acctSignup'); if (b) b.onclick = () => openAuth('signup');
  const c = $('#acctProfile'); if (c) c.onclick = () => openAuth('profile');
}
function authMsg(t, bad){ const el = $('#authMsg'); if (el){ el.textContent = t || ''; el.style.color = bad ? 'var(--danger, #e06c6c)' : 'var(--ok, #9fd49a)'; } }
function niceAuthError(e){
  const m = (e && e.message) || String(e);
  if (/invalid login/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/already registered|already been registered|already exists/i.test(m)) return 'Ese correo ya tiene cuenta. Usa «Entrar».';
  if (/provider is not enabled|unsupported provider/i.test(m)) return 'El acceso con Google aún no está activado en el servidor.';
  if (/manual linking/i.test(m)) return null;
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera un poco.';
  if (/email not confirmed/i.test(m)) return 'Confirma primero tu correo (revisa la bandeja de entrada y el spam).';
  if (/password/i.test(m) && /(short|weak|characters|least|pwned|leaked|known)/i.test(m)) return 'El servidor considera la contraseña demasiado débil o filtrada en internet: elige otra más larga.';
  if (/redirect/i.test(m)) return 'La dirección de la app no está autorizada en el servidor de cuentas (Redirect URLs).';
  return m;
}
const PW_RULES = [
  ['len', 'Al menos 8 caracteres (mejor 12 o más)', pw => pw.length >= 8, true],
  ['low', 'Una letra minúscula', pw => /[a-zñ]/.test(pw), true],
  ['up', 'Una letra mayúscula', pw => /[A-ZÑ]/.test(pw), true],
  ['num', 'Un número', pw => /\d/.test(pw), true],
  ['sym', 'Un símbolo (!?#@…) — recomendado', pw => /[^A-Za-z0-9ñÑ]/.test(pw), false]
];
// Contraseñas conocidas por ser de las más usadas (solas o con números/símbolos al final)
const PW_COMMON = /^(password|passw0rd|contrase[nñ]a|qwerty|qwertyuiop|asdfgh|123456|1234567|12345678|123456789|abc123|abcd1234|111111|000000|dragon|letmein|admin|iloveyou|teamo|monkey|football|futbol|princesa|welcome|bienvenido)[\d!.?#@_-]*$/i;
function pwOk(pw){ return PW_RULES.every(r => !r[3] || r[2](pw)) && !PW_COMMON.test(pw); }
function pwScore(pw){
  if (!pw) return 0;
  let sc = PW_RULES.filter(r => r[2](pw)).length + (pw.length >= 12 ? 1 : 0) + (pw.length >= 16 ? 1 : 0);
  if (PW_COMMON.test(pw) || /(.)\1{2,}/.test(pw)) sc -= 2;
  return Math.max(0, Math.min(6, sc));
}
function pwFieldsHtml(label){
  return '<div class="field"><label>' + label + '</label><div class="pw-wrap"><input id="authPw" type="password" autocomplete="new-password" maxlength="72" placeholder="Crea una contraseña segura"><button type="button" class="pw-eye" data-for="authPw" title="Mostrar u ocultar">👁</button></div></div>' +
    '<div class="pw-meter"><i id="pwBar"></i></div><div class="mini" id="pwLevel" style="margin:2px 0 6px">Escribe tu contraseña</div>' +
    '<ul class="pw-rules" id="pwRules">' + PW_RULES.map(r => '<li data-r="' + r[0] + '"' + (r[3] ? '' : ' class="opt"') + '>' + r[1] + '</li>').join('') + '</ul>' +
    '<div class="field"><label>Repite la contraseña</label><div class="pw-wrap"><input id="authPw2" type="password" autocomplete="new-password" maxlength="72" placeholder="Escríbela otra vez"><button type="button" class="pw-eye" data-for="authPw2" title="Mostrar u ocultar">👁</button></div><div class="mini" id="pwMatch" style="margin-top:3px"></div></div>' +
    '<div class="help-tip" style="margin-top:6px">💡 Consejo: usa una frase de 3-4 palabras que solo tú entiendas, con algún número y símbolo (ej. <i>Dragon-azul-come-7-tartas!</i>). No la reutilices de otras webs.</div>';
}
function bindPwFields(){
  const a = $('#authPw'), b = $('#authPw2'); if (!a || !b) return;
  const lv = ['Muy débil', 'Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte', 'Muy fuerte'];
  const col = ['#c0392b', '#c0392b', '#e67e22', '#d4ac0d', '#7dbb53', '#3fa34d', '#2e8b57'];
  const upd = () => {
    const pw = a.value, sc = pwScore(pw);
    PW_RULES.forEach(r => { const li = $('#pwRules li[data-r="' + r[0] + '"]'); if (li) li.classList.toggle('ok', r[2](pw)); });
    $('#pwBar').style.width = (sc / 6 * 100) + '%'; $('#pwBar').style.background = col[sc];
    $('#pwLevel').textContent = pw ? 'Seguridad: ' + lv[sc] + (PW_COMMON.test(pw) ? ' · es una contraseña muy común' : '') : 'Escribe tu contraseña';
    const m = $('#pwMatch');
    if (!b.value) { m.textContent = ''; }
    else if (b.value === pw){ m.textContent = '✓ Las contraseñas coinciden'; m.style.color = '#7dbb53'; }
    else { m.textContent = '✗ No coinciden'; m.style.color = '#e06c6c'; }
    const go = $('#authGo'); if (go) go.disabled = !(pwOk(pw) && b.value === pw);
  };
  a.oninput = upd; b.oninput = upd; upd();
  $$('#authBody .pw-eye').forEach(btn => btn.onclick = () => { const i = $('#' + btn.dataset.for); i.type = i.type === 'password' ? 'text' : 'password'; btn.textContent = i.type === 'password' ? '👁' : '🙈'; });
}
// ¿Tiene el servidor activado el acceso con Google? (endpoint público de Supabase Auth)
async function authSettings(){
  if (S.authSettings) return S.authSettings;
  try {
    const r = await fetch(S.cfg.url + '/auth/v1/settings', { headers: { apikey: S.cfg.anon } });
    S.authSettings = r.ok ? await r.json() : {};
  } catch(e){ S.authSettings = {}; }
  return S.authSettings;
}
async function googleAuth(link){
  const st = await authSettings();
  if (st && st.external && st.external.google === false){
    authMsg('El acceso con Google todavía no está activado en el servidor. De momento usa tu correo y contraseña.', true);
    return;
  }
  authMsg('Abriendo Google…');
  if (link && isGuest()){
    const r = await SB.auth.linkIdentity({ provider: 'google', options: { redirectTo: redirectUrl() } });
    if (!r.error) return;
    const nice = niceAuthError(r.error);
    if (nice){ authMsg(nice, true); return; }
  }
  const r2 = await SB.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl() } });
  if (r2.error) authMsg(niceAuthError(r2.error), true);
}
function openAuth(mode){
  const body = $('#authBody');
  const tabs = '<div class="auth-tabs"><button data-m="login"' + (mode === 'login' ? ' class="active"' : '') + '>Entrar</button><button data-m="signup"' + (mode === 'signup' ? ' class="active"' : '') + '>Crear cuenta</button></div>';
  let html = '';
  if (mode === 'login' || mode === 'signup'){
    $('#authTitle').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
    html = tabs +
      '<button class="gbtn" id="authGoogle">' + GOOGLE_SVG + (mode === 'login' ? 'Entrar con Google' : 'Crear cuenta con Google') + '</button>' +
      '<div class="or">o con tu correo</div>' +
      '<div class="field"><label>Correo electrónico</label><input id="authEmail" type="email" autocomplete="email" maxlength="120" placeholder="tu@correo.com"></div>' +
      (mode === 'login'
        ? '<div class="field"><label>Contraseña</label><div class="pw-wrap"><input id="authPw" type="password" autocomplete="current-password" maxlength="72" placeholder="••••••••"><button type="button" class="pw-eye" data-for="authPw" title="Mostrar u ocultar">👁</button></div></div>'
        : pwFieldsHtml('Contraseña')) +
      '<button class="primary" id="authGo" style="width:100%">' + (mode === 'login' ? 'Entrar' : 'Crear cuenta') + '</button>' +
      (mode === 'login' ? '<div style="text-align:center; margin-top:10px"><a href="#" id="authForgot" class="mini">¿Has olvidado la contraseña?</a></div>' : '') +
      '<div class="mini" id="authMsg" style="margin-top:10px; min-height:16px"></div>' +
      '<div class="mini muted" style="margin-top:6px">' + (mode === 'signup'
        ? (isGuest() ? '✅ Lo que ya tienes como invitado (partidas y personajes) pasa a tu cuenta. ' : '') + 'Solo guardamos tu correo y el nombre que elijas; los demás jugadores nunca ven tu correo.'
        : 'Al entrar con otra cuenta, lo que hayas hecho como invitado en este navegador se queda en el invitado.') + '</div>';
  } else if (mode === 'forgot'){
    $('#authTitle').textContent = 'Recuperar contraseña';
    html = '<div class="field"><label>Correo de tu cuenta</label><input id="authEmail" type="email" autocomplete="email" maxlength="120"></div>' +
      '<button class="primary" id="authGo" style="width:100%">Enviarme un enlace</button><div class="mini" id="authMsg" style="margin-top:10px"></div>';
  } else if (mode === 'newpw'){
    $('#authTitle').textContent = 'Nueva contraseña';
    html = '<div class="mini" style="margin-bottom:8px">Elige la contraseña para entrar con ' + esc((S.user && S.user.email) || 'tu correo') + '.</div>' +
      pwFieldsHtml('Nueva contraseña') +
      '<button class="primary" id="authGo" style="width:100%">Guardar contraseña</button><div class="mini" id="authMsg" style="margin-top:10px"></div>';
  } else if (mode === 'profile'){
    $('#authTitle').textContent = '👤 Tu perfil';
    const prov = ((S.user.app_metadata || {}).providers || []).map(x => x === 'google' ? 'Google' : x === 'email' ? 'correo y contraseña' : x).join(' · ');
    html = '<div class="card"><div class="mini">Cuenta</div><b>' + esc(S.user.email || '') + '</b><div class="mini">Acceso: ' + esc(prov || 'correo') + '</div></div>' +
      '<div class="field"><label>Nombre que verá el grupo</label><div class="row"><input id="profName" class="grow" maxlength="24" value="' + esc(lsGet('vtt_name') || '') + '"><button class="small primary" id="profSave">Guardar</button></div></div>' +
      '<div class="section-title">🧙 Tus personajes</div><div id="profChars" class="mini">Cargando…</div>' +
      '<div class="section-title">🔒 Seguridad</div>' +
      '<div class="row" style="flex-wrap:wrap"><button class="small" id="profPw">Cambiar contraseña</button><button class="small" id="profLogout">Cerrar sesión</button></div>' +
      '<div class="section-title" style="color:#e06c6c">Zona peligrosa</div>' +
      '<div class="mini">Borra tu cuenta, las partidas que diriges, sus mapas y tus mensajes. Tus personajes en partidas de otros quedan libres. No se puede deshacer.</div>' +
      '<div class="row" style="margin-top:6px"><input id="profDelTxt" class="grow" placeholder="Escribe BORRAR para confirmar" autocomplete="off"><button class="small" id="profDel" style="border-color:#e06c6c; color:#e06c6c">Borrar cuenta</button></div>' +
      '<div class="mini" id="authMsg" style="margin-top:10px"></div>';
  }
  body.innerHTML = html;
  $('#authModal').classList.add('open');
  $$('#authBody .auth-tabs button').forEach(b => b.onclick = () => openAuth(b.dataset.m));
  const gg = $('#authGoogle'); if (gg) gg.onclick = () => googleAuth(mode === 'signup');
  if (gg) authSettings().then(st => { if (st && st.external && st.external.google === false){ gg.classList.add('off'); gg.title = 'Aún no activado en el servidor'; } });
  if (mode === 'signup' || mode === 'newpw') bindPwFields();
  else $$('#authBody .pw-eye').forEach(btn => btn.onclick = () => { const i = $('#' + btn.dataset.for); i.type = i.type === 'password' ? 'text' : 'password'; btn.textContent = i.type === 'password' ? '👁' : '🙈'; });
  const fg = $('#authForgot'); if (fg) fg.onclick = e => { e.preventDefault(); openAuth('forgot'); };
  const go = $('#authGo');
  const enter = e => { if (e.key === 'Enter' && go) go.click(); };
  $$('#authBody input').forEach(i => i.onkeydown = enter);
  if (go) go.onclick = async () => {
    const email = ($('#authEmail') ? $('#authEmail').value : '').trim().toLowerCase();
    const pw = $('#authPw') ? $('#authPw').value : '', pw2 = $('#authPw2') ? $('#authPw2').value : pw;
    if ((mode === 'login' || mode === 'signup' || mode === 'forgot') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ authMsg('Escribe un correo válido', true); return; }
    if ((mode === 'signup' || mode === 'newpw') && !pwOk(pw)){ authMsg('La contraseña no cumple los requisitos marcados en la lista', true); return; }
    if ((mode === 'signup' || mode === 'newpw') && pw !== pw2){ authMsg('Las contraseñas no coinciden', true); return; }
    go.disabled = true; authMsg('Un momento…');
    try {
      if (mode === 'login'){
        const { error } = await SB.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
        authMsg('¡Dentro! Cargando tu cuenta…'); setTimeout(() => location.replace(redirectUrl()), 400);
      } else if (mode === 'signup'){
        if (isGuest()){
          let r = await SB.auth.updateUser({ email, password: pw }, { emailRedirectTo: redirectUrl() });
          if (r.error && /password/i.test(r.error.message) && !/(short|weak|least)/i.test(r.error.message)){
            r = await SB.auth.updateUser({ email, data: { need_pw: true } }, { emailRedirectTo: redirectUrl() });
          }
          if (r.error) throw r.error;
          S.user = r.data.user || S.user;
          saveProfileName(lsGet('vtt_name'));
          renderAccount();
          authMsg(S.user.email ? '✅ Cuenta creada.' : '📧 Te hemos enviado un correo a ' + email + '. Pulsa el enlace para activar la cuenta (mira también en spam).');
        } else {
          const { error } = await SB.auth.signUp({ email, password: pw, options: { emailRedirectTo: redirectUrl() } });
          if (error) throw error;
          authMsg('📧 Te hemos enviado un correo a ' + email + ' para activar la cuenta.');
        }
      } else if (mode === 'forgot'){
        const { error } = await SB.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
        if (error) throw error;
        authMsg('📧 Si existe una cuenta con ese correo, te llegará un enlace para elegir una nueva contraseña.');
      } else if (mode === 'newpw'){
        const { error } = await SB.auth.updateUser({ password: pw, data: { need_pw: false } });
        if (error) throw error;
        authMsg('✅ Contraseña guardada'); setTimeout(() => $('#authModal').classList.remove('open'), 900);
      }
    } catch(e){ authMsg(niceAuthError(e) || 'No se pudo completar', true); }
    go.disabled = false;
  };
  if (mode === 'profile'){
    $('#profSave').onclick = () => {
      const v = $('#profName').value.trim(); if (!v) return;
      lsSet('vtt_name', v); $('#myName').value = v; saveProfileName(v); renderAccount(); authMsg('✅ Nombre guardado');
    };
    $('#profPw').onclick = () => openAuth('newpw');
    $('#profLogout').onclick = async () => { await SB.auth.signOut(); lsSet('vtt_game', null); location.replace(redirectUrl()); };
    $('#profDel').onclick = async () => {
      if ($('#profDelTxt').value.trim().toUpperCase() !== 'BORRAR'){ authMsg('Escribe BORRAR para confirmar', true); return; }
      $('#profDel').disabled = true;
      try { await rpc('delete_my_account', {}); await SB.auth.signOut(); localStorage.clear(); location.replace(redirectUrl()); }
      catch(e){ authMsg(e.message, true); $('#profDel').disabled = false; }
    };
    rpc('my_characters', {}).then(rows => {
      const el = $('#profChars'); if (!el) return;
      el.innerHTML = rows && rows.length ? rows.map(r => '<div class="eq-row"><span class="k">' + esc(r.game_name) + '</span><span class="v"><b>' + esc(r.name) + '</b> · Nv ' + (r.lvl || 1) + ' · PV ' + (r.hp || 0) + '/' + (r.hp_max || 0) + (r.map_name ? ' · 🗺 ' + esc(r.map_name) : '') + '</span></div>').join('') : 'Aún no tienes personajes. Entra en una partida y elige uno.';
    }).catch(() => {});
  }
  setTimeout(() => { const f = $('#authBody input'); if (f && mode !== 'profile') f.focus(); }, 60);
}
function maybeNeedPassword(){
  if (S.user && S.user.email && (S.user.user_metadata || {}).need_pw && !$('#authModal').classList.contains('open')) openAuth('newpw');
}
$('#authClose').onclick = () => $('#authModal').classList.remove('open');
$('#authModal').addEventListener('click', e => { if (e.target.id === 'authModal') $('#authModal').classList.remove('open'); });

async function refreshLobby(){
  if (!SB || S.localMode) return;
  const { data, error } = await SB.rpc('list_games');
  if (!error){ S.lobbyGames = data || []; renderLobby(); }
}
function gameRow(g){
  return '<div class="game-item"><div class="row between">' +
    '<div style="min-width:0"><b>' + esc(g.name) + '</b> ' + (g.private ? '🔒' : '') + (g.is_dm ? ' <span class="mini" style="color:var(--accent)">· eres el DM</span>' : '') +
    '<div class="mini">' + (g.dm_name && !g.is_dm ? 'DM: ' + esc(g.dm_name) + ' · ' : '') + (g.players || 0) + ' jugador' + (g.players === 1 ? '' : 'es') +
    (g.active_map ? ' · 🗺 ' + esc(g.active_map) : '') + (g.created_at ? ' · ' + new Date(Number(g.created_at)).toLocaleDateString() : '') + '</div></div>' +
    '<div class="row">' +
    (g.is_dm ? '<button class="small g-del" data-id="' + esc(g.id) + '" title="Borrar partida">🗑</button>' : '') +
    (g.is_member && !g.is_dm ? '<button class="small g-leave" data-id="' + esc(g.id) + '" title="Abandonar partida">🚪</button>' : '') +
    '<button class="primary small g-join" data-id="' + esc(g.id) + '">' + (g.is_member ? 'Entrar' : 'Unirme') + '</button>' +
    '</div></div></div>';
}
function renderLobby(){
  if (!$('#lobby').classList.contains('open')) return;
  renderAccount();
  const list = $('#lobbyList');
  if (S.localMode){ list.innerHTML = ''; return; }
  const mine = S.lobbyGames.filter(g => g.is_member || g.is_dm);
  const pub = S.lobbyGames.filter(g => !g.is_member && !g.is_dm);
  let html = '';
  html += '<div class="lobby-sec">🎲 Tus partidas</div>' + (mine.length ? mine.map(gameRow).join('') : '<div class="muted" style="padding:6px 2px">Aún no estás en ninguna. Crea una o únete con un código.</div>');
  if (pub.length) html += '<div class="lobby-sec">🌍 Partidas públicas</div>' + pub.map(gameRow).join('');
  list.innerHTML = html;
  $$('.g-join').forEach(b => b.onclick = () => enterGame(b.dataset.id, ''));
  $$('.g-leave').forEach(b => b.onclick = () => armConfirm(b, async () => {
    try { await rpc('leave_game', { gid: b.dataset.id }); toast('Has abandonado la partida'); refreshLobby(); } catch(e){ toast(e.message, true); }
  }));
  $$('.g-del').forEach(b => b.onclick = () => armConfirm(b, async () => {
    const gid = b.dataset.id;
    try {
      const { error: e1 } = await SB.from('tokens').delete().eq('data->>gameId', gid); if (e1) throw e1;
      await SB.from('rolls').delete().eq('data->>gameId', gid);
      const { error: e2 } = await SB.from('games').delete().eq('id', gid); if (e2) throw e2;
      toast('Partida borrada'); DB.reload(); refreshLobby();
    } catch(e){ toast('No se pudo borrar: ' + (e.message || e), true); }
  }));
}
async function enterGame(gid, code){
  if (S.localMode){ joinGame(gid); return; }
  if (!(lsGet('vtt_name') || '').trim() && !($('#myName').value || '').trim()){ askName(() => enterGame(gid, code)); return; }
  lsSet('vtt_name', ($('#myName').value || lsGet('vtt_name') || '').trim());
  try {
    const r = await rpc('join_game', { gid, gcode: code || '', pname: myName() });
    if (r && r.error){ toast(r.error, true); return; }
    await DB.reload();
    joinGame(gid);
  } catch(e){ toast(e.message || String(e), true); }
}
$('#btnJoinCode').onclick = async () => {
  const code = ($('#joinCodeInp').value || '').trim().toUpperCase();
  if (code.length < 4){ toast('Escribe el código que te ha dado el DM', true); return; }
  if (!($('#myName').value || '').trim()){ toast('Escribe primero tu nombre', true); $('#myName').focus(); return; }
  lsSet('vtt_name', $('#myName').value.trim());
  $('#btnJoinCode').disabled = true;
  try {
    const r = await rpc('join_by_code', { gcode: code, pname: myName() });
    if (r && r.error) toast(r.error, true);
    else { $('#joinCodeInp').value = ''; await DB.reload(); joinGame(r.id); }
  } catch(e){ toast(e.message || String(e), true); }
  $('#btnJoinCode').disabled = false;
};
$('#joinCodeInp').onkeydown = e => { if (e.key === 'Enter') $('#btnJoinCode').click(); };
$('#btnCreateGame').onclick = async () => {
  const name = $('#newGameName').value.trim();
  if (!name){ toast('Ponle nombre a la partida', true); return; }
  lsSet('vtt_name', $('#myName').value.trim());
  const priv = $('#newGamePriv').checked;
  if (S.localMode){ toast('Sin conexión no se pueden crear partidas', true); return; }
  $('#btnCreateGame').disabled = true;
  try {
    const r = await rpc('create_game', { gname: name, priv, pname: myName() });
    $('#newGameName').value = '';
    await DB.reload();
    joinGame(r.id);
    if (r.code) toast('Partida creada. Código para tus jugadores: ' + r.code);
    refreshLobby();
  } catch(e){ toast('No se pudo crear: ' + (e.message || e), true); }
  $('#btnCreateGame').disabled = false;
};
function joinGame(id, silent){
  const g = S.games[id];
  if (!g && !silent){ toast('Esa partida ya no existe', true); return; }
  if (!S.projector) lsSet('vtt_name', ($('#myName').value || lsGet('vtt_name') || '').trim());
  S.gameId = id;
  S.isDM = S.localMode ? true : !!(g && g.dmId === S.uid);
  S.lobbyManual = false;
  S.gameCode = null;
  if (S.isDM && !S.localMode && g && g.private){
    SB.from('game_secrets').select('code').eq('game_id', id).maybeSingle().then(({ data }) => {
      if (S.gameId === id && data){ S.gameCode = data.code; qrFor = null; updateGameBadge(); updateQR(); renderPanel(); }
    });
  }
  if (S.projector){ S.viewAsPlayer = true; S.fogDirty = true; }
  else lsSet('vtt_game', { id });
  if (!S.isDM && !S.projector) S.tab = 'pj';
  S.attackPick = false; S.invSel = null;
  $('#lobby').classList.remove('open');
  $('#btnLeave').style.display = '';
  updateGameBadge();
  S.activeMapId = null;
  applyRole();
  syncFromGame();
  joinRoomFor(id);
  selectTab(S.tab);
  updateQR();
  maybeOfferTour();
  syncAudio();   // si ya suena música en la partida, empezar a oírla al entrar
}
function leaveGame(){
  S.gameId = null; S.isDM = false; S.lobbyManual = true;
  lsSet('vtt_game', null);
  if (GCH && SB){ try { SB.removeChannel(GCH); } catch(e){} }
  GCH = null; S.peers = []; renderPeers();
  setRulerMode(false); setTplMode(false); S.rulers = {}; flushExploredSaves();
  applyRole(); showLobby(); renderPanel(); needsDraw(); updateQR(); refreshLobby(); syncAudio();
}
$('#btnLeave').onclick = leaveGame;
function updateGameBadge(){
  const g = gameDoc();
  const b = $('#gameBadge');
  if (!g){ b.style.display = 'none'; return; }
  b.style.display = '';
  b.textContent = '🎲 ' + g.name + (S.isDM && S.gameCode ? ' · ' + S.gameCode : '');
  b.title = S.isDM && S.gameCode ? 'Código de la partida: ' + S.gameCode : g.name;
  updateProjTitle();
}
function joinRoomFor(id){
  if (!SB || S.localMode) return;
  if (GCH){ try { SB.removeChannel(GCH); } catch(e){} GCH = null; }
  const ch = SB.channel('game-' + id, { config: { private: true, presence: { key: S.uid }, broadcast: { self: false } } });
  ch.on('broadcast', { event: 'tok-refresh' }, () => { if (!S.isDM) DB.reload(['tokens']); });
  ch.on('broadcast', { event: 'ping' }, p => {
    const d = p && p.payload;
    if (d && typeof d.x === 'number' && typeof d.y === 'number'){
      S.pings.push({ x: d.x, y: d.y, t: performance.now() });
      needsDraw();
    }
  });
  ch.on('broadcast', { event: 'ruler' }, p => onRemoteRuler(p && p.payload));
  ch.on('presence', { event: 'sync' }, () => {
    try {
      const st = ch.presenceState();
      S.peers = Object.values(st).flat();
    } catch(e){ S.peers = []; }
    renderPeers();
  });
  ch.subscribe(status => {
    if (status === 'SUBSCRIBED'){
      if (!S.projector){ try { ch.track({ uid: S.uid, name: myName(), dm: S.isDM }); } catch(e){} }
    }
  });
  GCH = ch;
}
function renderPeers(){
  const bar = $('#peersBar'); bar.innerHTML = '';
  const seen = new Set();
  S.peers.forEach(p => {
    const uid = p.uid || '?';
    if (seen.has(uid)) return; seen.add(uid);
    const d = document.createElement('div'); d.className = 'peer';
    const n = p.name || 'Aventurero';
    d.textContent = (n || 'A').trim().charAt(0).toUpperCase() || 'A';
    d.title = n + (p.dm ? ' (DM)' : '') + (uid === S.uid ? ' — tú' : '');
    if (p.dm) d.style.background = 'var(--accent2)';
    bar.appendChild(d);
  });
}

/* ============ suscripciones ============ */
function startSubscriptions(){
  DB.collection('games').onSnapshot(snap => {
    const arr = snapDocs(snap); S.games = {};
    arr.forEach(g => { S.games[g.id] = g; });
    if (S.gameId && !S.games[S.gameId] && !S.localMode){
      toast('La partida ha sido cerrada por el DM'); leaveGame(); return;
    }
    if (S.join && !S.gameId && !S.lobbyManual && !S.localMode){
      if (S.games[S.join]){ joinGame(S.join, true); return; }
      if (!S.joinTried){
        S.joinTried = true;
        const go = () => enterGame(S.join, S.joinCode || '');
        if (!(lsGet('vtt_name') || '').trim()) askName(go); else go();
      }
    }
    if (S.projector && !S.gameId){
      if (S.games[S.projector]) joinGame(S.projector, true);
      return;
    }
    if (!S.gameId && !S.lobbyManual && !S.localMode){
      const st = lsGet('vtt_game');
      if (st && st.id && S.games[st.id]){ joinGame(st.id, true); return; }
    }
    if (S.gameId && !S.localMode){
      const g = gameDoc();
      const dmNow = !!(g && g.dmId === S.uid);
      if (dmNow !== S.isDM){ S.isDM = dmNow; applyRole(); }
    }
    updateGameBadge(); syncFromGame(); renderLobby(); renderCombatBadge(); renderPanel(); needsDraw(); updateQR(); syncAudio();
  });
  DB.collection('maps').onSnapshot(snap => {
    const arr = snapDocs(snap); S.maps = {};
    arr.forEach(m => { S.maps[m.id] = m; });
    checkExploredResets();
    S.fogDirty = true; loadActiveMedia(); renderPanel(); needsDraw(); updateProjTitle();
  });
  DB.collection('tokens').onSnapshot(snap => {
    const arr = snapDocs(snap); S.tokens = {};
    arr.forEach(t => { S.tokens[t.id] = t; });
    S.fogDirty = true; renderPanel(); needsDraw(); followMyPC();
  });
  DB.collection('templates').onSnapshot(snap => {
    S.templates = snapDocs(snap);
    needsDraw(); renderTplBar();
  });
  DB.collection('rolls').onSnapshot(snap => {
    const all = snapDocs(snap);
    S.rolls = all.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 120);
    if (S.tab === 'dice') renderPanel();
    animateNewRolls(S.rolls);
  });
}
function syncFromGame(){
  const g = gameDoc();
  const newMap = g ? (g.activeMapId || null) : null;
  if (newMap !== S.activeMapId){
    S.activeMapId = newMap; S.fogDirty = true; loadActiveMedia();
    S.tplDraft = null; updateProjTitle();
    if (S.ruler){ S.ruler = null; updateRulerBar(); rulerSend(true); }
  } else {
    $('#emptyState').style.display = (S.gameId && !newMap) ? 'flex' : (newMap ? 'none' : 'flex');
  }
}
function saveGame(patch){
  if (!S.gameId) return;
  const g = Object.assign({}, gameDoc() || {}, patch);
  DB.doc('games/' + S.gameId).set(g).catch(e => toast('No se pudo guardar: ' + (e.message || e), true));
}
function gameMaps(){ return Object.values(S.maps).filter(m => (m.gameId || null) === (S.gameId || null) || (S.localMode && !m.gameId)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); }
function gamePCs(){ return Object.values(S.tokens).filter(t => t.type === 'pc' && (t.gameId || null) === (S.gameId || null)).sort((a, b) => (a.name || '').localeCompare(b.name || '')); }
function myPC(){ return gamePCs().find(t => t.ownerId === S.uid) || null; }
function safeUrl(u){ u = String(u || ''); return IMG_RE.test(u) ? u : ''; }
function freeSpot(m, near){
  const g = gridOf(m), occ = new Set(gameTokens(m.id).map(t => Math.floor(t.x / g) + ',' + Math.floor(t.y / g)));
  const cx = Math.floor(near.x / g), cy = Math.floor(near.y / g);
  for (let r = 0; r < 30; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++){
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || (m.w && x * g > m.w) || (m.h && y * g > m.h) || occ.has(x + ',' + y)) continue;
    const px = x * g + g / 2, py = y * g + g / 2;
    if (r === 0 || typeof losClear !== 'function' || losClear(m, near.x, near.y, px, py)) return { x: px, y: py };
  }
  return { x: near.x, y: near.y };
}
function setSpawnMode(on){
  S.pickSpawn = !!on && !!activeMap();
  $('#btnSpawn').classList.toggle('on', S.pickSpawn);
  $('#spawnHint').style.display = S.pickSpawn ? 'block' : 'none';
  if (on && !activeMap()) toast('Activa primero un mapa', true);
}
$('#btnSpawn').onclick = () => setSpawnMode(!S.pickSpawn);
$('#spawnCancel').onclick = e => { e.preventDefault(); setSpawnMode(false); };
// Activar un mapa; si la partida tiene el traslado automático activado, el grupo viaja con el DM al punto de aparición
async function activateMap(mapId){
  const g = gameDoc() || {};
  const prev = S.activeMapId;
  saveGame({ activeMapId: mapId });
  if (g.autoMove === false || !mapId || mapId === prev) return;
  const ids = gamePCs().filter(t => t.mapId !== mapId && (!t.mapId || t.mapId === prev || !S.maps[t.mapId])).map(t => t.id);
  if (ids.length) await movePCsTo(ids, mapId, true).catch(e => toast(e.message, true));
}
async function movePCsTo(ids, mapId, viaSpawn){
  const m = mapId ? S.maps[mapId] : null;
  let anchor = null;
  if (m){
    const there = gameTokens(m.id).find(t => t.type === 'pc' && !ids.includes(t.id));
    if (m.spawn && (viaSpawn || !there)) anchor = { x: m.spawn.x, y: m.spawn.y };
    else if (there) anchor = { x: there.x, y: there.y };
    else if (m.id === S.activeMapId && S.media.w){ const r = cv.getBoundingClientRect(); anchor = screenToMap(r.width / 2, r.height / 2); }
    else anchor = { x: (m.w || 1000) / 2, y: (m.h || 1000) / 2 };
  }
  for (const id of ids){
    const t = S.tokens[id]; if (!t) continue;
    if (!m){ await DB.doc('tokens/' + id).update({ mapId: null }); continue; }
    const pos = freeSpot(m, anchor);
    await DB.doc('tokens/' + id).update({ mapId: m.id, x: pos.x, y: pos.y });
  }
  toast(ids.length + ' PJ → ' + (m ? '«' + m.name + '»' : 'banquillo'));
}
function gameTokens(mapId){
  return Object.values(S.tokens).filter(t => t.mapId === mapId && (t.gameId || null) === (S.gameId || null));
}

/* ============ mapa activo y media ============ */
function activeMap(){ return S.activeMapId ? S.maps[S.activeMapId] : null; }
function loadActiveMedia(){
  const m = activeMap();
  $('#emptyState').style.display = m ? 'none' : 'flex';
  if (!m){ S.media = { mapId: null, img: null, video: null, w: 0, h: 0 }; return; }
  if (S.media.mapId === m.id && (S.media.img || S.media.video)) return;
  const url = m.assetUrl || null;
  S.media = { mapId: m.id, img: null, video: null, w: m.w || 0, h: m.h || 0 };
  if (!url) return;
  if (m.mediaType === 'video'){
    const v = document.createElement('video');
    v.src = url; v.loop = true; v.muted = true; v.playsInline = true; v.autoplay = true; v.crossOrigin = 'anonymous';
    v.addEventListener('loadedmetadata', () => {
      S.media.video = v; S.media.w = m.w || v.videoWidth; S.media.h = m.h || v.videoHeight;
      v.play().catch(() => {});
      fitView(); S.fogDirty = true; needsDraw(); startVideoLoop();
    });
    v.addEventListener('error', () => toast('No se pudo cargar el vídeo del mapa', true));
  } else {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      S.media.img = img; S.media.w = m.w || img.naturalWidth; S.media.h = m.h || img.naturalHeight;
      fitView(); S.fogDirty = true; needsDraw();
    };
    img.onerror = () => toast('No se pudo cargar la imagen del mapa', true);
    img.src = url;
  }
}
let videoLoopOn = false;
function startVideoLoop(){
  if (videoLoopOn) return; videoLoopOn = true;
  (function loop(){
    if (S.media.video && activeMap() && activeMap().id === S.media.mapId){
      needsDraw(); requestAnimationFrame(loop);
    } else { videoLoopOn = false; }
  })();
}

/* ============ cámara y canvas ============ */
const cv = $('#cv'); const ctx = cv.getContext('2d');
let drawPending = false;
function needsDraw(){ if (!drawPending){ drawPending = true; requestAnimationFrame(() => { drawPending = false; draw(); }); } }
function resizeCanvas(){
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;   // mapa oculto (móvil): se redimensiona al volver a mostrarlo
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  needsDraw();
}
window.addEventListener('resize', resizeCanvas);
function fitView(whole){
  if (S.projector && lastCamMsg){ applyCamFromDM(lastCamMsg); return; }
  const m = activeMap(); if (!m || !S.media.w) return;
  const r = cv.getBoundingClientRect();
  const s = Math.min(r.width / S.media.w, r.height / S.media.h) * 0.95;
  // Jugador con el mapa entero demasiado pequeño (móvil): encuadrar a su PJ a un tamaño cómodo
  const pc = !S.isDM && !S.projector ? myPC() : null;
  if (!whole && pc && pc.mapId === m.id && gridOf(m) * s < 34){ focusOnPC(pc, m); return; }
  S.camFocus = false;
  S.cam.s = s;
  S.cam.x = (r.width - S.media.w * s) / 2;
  S.cam.y = (r.height - S.media.h * s) / 2;
  needsDraw();
}
let lastPcPos = null;
// Encuadra al PJ con casillas de ~46 px (o lo que quepa: al menos 7 casillas en el lado corto)
function focusOnPC(pc, m){
  const r = cv.getBoundingClientRect(); if (!r.width) return;
  const g = gridOf(m);
  const s = Math.min(46 / g, Math.min(r.width, r.height) / (7 * g));
  S.cam.s = s;
  S.cam.x = r.width / 2 - pc.x * s;
  S.cam.y = r.height / 2 - pc.y * s;
  S.camFocus = true;
  lastPcPos = pc.x + ',' + pc.y;
  needsDraw();
}
// Si mi PJ sale del encuadre (se ha movido), la cámara lo sigue con suavidad
function followMyPC(){
  if (S.isDM || S.projector) return;
  const pc = myPC(), m = activeMap();
  if (!pc || !m || pc.mapId !== m.id){ lastPcPos = null; return; }
  const pos = pc.x + ',' + pc.y;
  if (pos === lastPcPos) return;
  const first = lastPcPos === null; lastPcPos = pos;
  if (first) return;
  const r = cv.getBoundingClientRect(); if (!r.width) return;
  const sx = S.cam.x + pc.x * S.cam.s, sy = S.cam.y + pc.y * S.cam.s;
  const mx = r.width * 0.18, my = r.height * 0.18;
  if (sx >= mx && sx <= r.width - mx && sy >= my && sy <= r.height - my) return;
  const tx = r.width / 2 - pc.x * S.cam.s, ty = r.height / 2 - pc.y * S.cam.s;
  const x0 = S.cam.x, y0 = S.cam.y, t0 = performance.now();
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = now => {
    const k = reduce ? 1 : Math.min(1, (now - t0) / 350), e = 1 - Math.pow(1 - k, 3);
    S.cam.x = x0 + (tx - x0) * e; S.cam.y = y0 + (ty - y0) * e; needsDraw();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function screenToMap(sx, sy){ return { x: (sx - S.cam.x) / S.cam.s, y: (sy - S.cam.y) / S.cam.s }; }

function gridOf(m){ return Math.max(8, m.grid || 70); }
function snapToken(m, t, x, y){
  const g = gridOf(m), ox = m.gridOffX || 0, oy = m.gridOffY || 0;
  const sz = t.size || 1;
  if (sz % 2 === 1){
    return { x: ox + (Math.floor((x - ox) / g) + 0.5) * g, y: oy + (Math.floor((y - oy) / g) + 0.5) * g };
  }
  return { x: ox + Math.round((x - ox) / g) * g, y: oy + Math.round((y - oy) / g) * g };
}

/* ============ muros, puertas, visibilidad ============ */
function wallSegs(m, forVision){
  const out = [];
  const offX = (m.wallOffX || 0), offY = (m.wallOffY || 0);
  const ds = m.doorStates || {};
  (m.walls || []).forEach((w, i) => {
    if (forVision && w.sight === 0) return;
    if (w.door && ds[i]) return;
    out.push({ x1: w.x1 + offX, y1: w.y1 + offY, x2: w.x2 + offX, y2: w.y2 + offY, i });
  });
  const W = S.media.w || m.w || 0, H = S.media.h || m.h || 0;
  if (W && H){
    out.push({ x1: 0, y1: 0, x2: W, y2: 0 }, { x1: W, y1: 0, x2: W, y2: H }, { x1: W, y1: H, x2: 0, y2: H }, { x1: 0, y1: H, x2: 0, y2: 0 });
  }
  return out;
}
function raySegT(px, py, dx, dy, s){
  const sx = s.x2 - s.x1, sy = s.y2 - s.y1;
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = s.x1 - px, qy = s.y1 - py;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * dy - qy * dx) / den;
  if (t > 0.0001 && u >= -0.0001 && u <= 1.0001) return t;
  return null;
}
function visPolygon(cx, cy, maxR, segs){
  const near = segs.filter(s => {
    const minx = Math.min(s.x1, s.x2) - cx, maxx = Math.max(s.x1, s.x2) - cx;
    const miny = Math.min(s.y1, s.y2) - cy, maxy = Math.max(s.y1, s.y2) - cy;
    return !(minx > maxR || maxx < -maxR || miny > maxR || maxy < -maxR);
  });
  const angles = [];
  const MAXEP = 900;
  if (near.length * 2 < MAXEP){
    near.forEach(s => {
      [[s.x1, s.y1], [s.x2, s.y2]].forEach(p => {
        const a = Math.atan2(p[1] - cy, p[0] - cx);
        angles.push(a - 0.0006, a, a + 0.0006);
      });
    });
  }
  const RAD = 96;
  for (let i = 0; i < RAD; i++) angles.push(i / RAD * Math.PI * 2);
  angles.sort((a, b) => a - b);
  const pts = [];
  for (let k = 0; k < angles.length; k++){
    const a = angles[k];
    if (k > 0 && Math.abs(a - angles[k - 1]) < 1e-6) continue;
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = maxR;
    for (let j = 0; j < near.length; j++){
      const hit = raySegT(cx, cy, dx, dy, near[j]);
      if (hit !== null && hit < t) t = hit;
    }
    pts.push(cx + dx * t, cy + dy * t);
  }
  return pts;
}
function pointInPoly(px, py, pts){
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2){
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = true;
  }
  return inside;
}

const fogCanvas = document.createElement('canvas');
function playerFogActive(){
  const m = activeMap();
  if (!m || m.fog === false) return false;
  if (S.isDM && !S.viewAsPlayer) return false;
  return true;
}
function myToken(mapId){
  return gameTokens(mapId).find(t => t.type === 'pc' && t.ownerId === S.uid) || null;
}
function visionSources(m){
  const pcs = gameTokens(m.id).filter(t => !t.hidden && t.type === 'pc');
  // Jugador con personaje asignado: ve solo desde su PJ (salvo que el DM active visión compartida)
  if (!S.isDM && m.sharedVision !== true){
    const mine = pcs.find(t => t.ownerId === S.uid);
    if (mine) return [mine];
    return []; // sin personaje elegido: todo a oscuras
  }
  return pcs;
}
function getExplored(m){
  const key = (S.gameId || 'x') + ':' + m.id;
  let c = S.explored[key];
  const w = Math.max(1, Math.round((S.media.w || 1) * EXPLORED_SCALE));
  const h = Math.max(1, Math.round((S.media.h || 1) * EXPLORED_SCALE));
  if (!c || c.width !== w || c.height !== h){
    c = document.createElement('canvas'); c.width = w; c.height = h;
    c._reset = m.exploredReset || 0;
    S.explored[key] = c;
    loadExplored(m, c, key);
  }
  return c;
}
let fogReady = false;
const seenCanvas = document.createElement('canvas');   // lo que se ve AHORA (línea de visión ∩ luz)
const darkCanvas = document.createElement('canvas');   // capa de oscuridad con las luces recortadas
const glowCanvas = document.createElement('canvas');   // color de las luces
function polyPath(c, p){ if (p.length > 5){ c.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]); c.closePath(); } }
function fillPoly(c, p){ c.beginPath(); polyPath(c, p); c.fill(); }
function recomputeFog(){
  S.fogDirty = false; S.visPolys = []; S.visInfo = []; S.lights = []; S.needLight = false; fogReady = false;
  const m = activeMap(); if (!m || !S.media.w) return;
  const remember = m.rememberExplored !== false;
  const segs = wallSegs(m, true);
  const g = gridOf(m);
  const dark = mapDarkness(m);
  S.lights = dark > 0.01 ? mapLights(m, segs) : [];
  S.needLight = dark >= DARK_SEE;
  visionSources(m).forEach(t => {
    const vTiles = (t.vision == null ? (m.defaultVision || 12) : t.vision);
    const R = vTiles > 0 ? vTiles * g : Math.hypot(S.media.w, S.media.h);
    const poly = visPolygon(t.x, t.y, R, segs);
    S.visPolys.push(poly);
    S.visInfo.push({ x: t.x, y: t.y, poly, dv: darkvisionOf(t) * g });
  });
  const fs = Math.min(1, 2000 / Math.max(S.media.w, S.media.h));
  const W = Math.max(1, Math.round(S.media.w * fs)), H = Math.max(1, Math.round(S.media.h * fs));
  [fogCanvas, seenCanvas, darkCanvas, glowCanvas].forEach(c => { if (c.width !== W || c.height !== H){ c.width = W; c.height = H; } });
  // 1) Lo que se ve ahora
  const sc = seenCanvas.getContext('2d');
  sc.globalCompositeOperation = 'source-over'; sc.clearRect(0, 0, W, H);
  sc.save(); sc.scale(fs, fs); sc.fillStyle = '#fff';
  if (!S.needLight){
    sc.beginPath(); S.visPolys.forEach(p => polyPath(sc, p)); sc.fill();
  } else if (S.visPolys.length){
    S.lights.forEach(l => fillPoly(sc, l.poly));
    S.visInfo.forEach(v => { if (v.dv > 0){ sc.save(); sc.beginPath(); sc.arc(v.x, v.y, v.dv, 0, Math.PI * 2); sc.clip(); fillPoly(sc, v.poly); sc.restore(); } });
    sc.globalCompositeOperation = 'destination-in';          // solo dentro de la línea de visión
    sc.beginPath(); S.visPolys.forEach(p => polyPath(sc, p)); sc.fill();
    sc.globalCompositeOperation = 'source-over';
  }
  sc.restore();
  // 2) Zonas exploradas (se guardan)
  const ex = getExplored(m);
  if (S.visPolys.length){
    ex.getContext('2d').drawImage(seenCanvas, 0, 0, ex.width, ex.height);
    if (playerFogActive() && remember) scheduleExploredSave(m.id);
  }
  // 3) Niebla
  const fc = fogCanvas.getContext('2d');
  fc.globalCompositeOperation = 'source-over'; fc.globalAlpha = 1;
  fc.clearRect(0, 0, W, H); fc.fillStyle = '#000'; fc.fillRect(0, 0, W, H);
  fc.globalCompositeOperation = 'destination-out';
  if (remember){ fc.globalAlpha = 0.35; fc.drawImage(ex, 0, 0, W, H); fc.globalAlpha = 1; }
  fc.drawImage(seenCanvas, 0, 0);
  fc.globalCompositeOperation = 'source-over';
  // 4) Oscuridad y color de las luces
  const dc = darkCanvas.getContext('2d'), gc = glowCanvas.getContext('2d');
  dc.globalCompositeOperation = 'source-over'; dc.clearRect(0, 0, W, H);
  gc.clearRect(0, 0, W, H);
  if (dark > 0.01){
    dc.fillStyle = 'rgba(0,0,0,' + (dark * 0.92).toFixed(3) + ')'; dc.fillRect(0, 0, W, H);
    dc.save(); dc.scale(fs, fs); dc.globalCompositeOperation = 'destination-out';
    gc.save(); gc.scale(fs, fs);
    S.lights.forEach(l => {
      const b = clamp(l.bright / l.dim, 0, 0.98);
      dc.save(); dc.beginPath(); polyPath(dc, l.poly); dc.clip();
      const gr = dc.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.dim);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(b, 'rgba(0,0,0,0.97)'); gr.addColorStop(Math.min(1, b + (1 - b) * 0.55), 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      dc.fillStyle = gr; dc.fillRect(l.x - l.dim, l.y - l.dim, l.dim * 2, l.dim * 2); dc.restore();
      gc.save(); gc.beginPath(); polyPath(gc, l.poly); gc.clip();
      const gg = gc.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.dim), rgb = hexRgb(l.color), a = clamp(l.alpha, 0, 1) * 0.55;
      gg.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); gg.addColorStop(1, 'rgba(' + rgb + ',0)');
      gc.fillStyle = gg; gc.fillRect(l.x - l.dim, l.y - l.dim, l.dim * 2, l.dim * 2); gc.restore();
    });
    // visión en la oscuridad: ve en penumbra
    S.visInfo.forEach(v => { if (v.dv > 0){ dc.save(); dc.beginPath(); dc.arc(v.x, v.y, v.dv, 0, Math.PI * 2); dc.clip(); dc.fillStyle = 'rgba(0,0,0,0.5)'; fillPoly(dc, v.poly); dc.restore(); } });
    dc.restore(); gc.restore();
  }
  fogReady = true;
}
function hexRgb(h){
  h = String(h || '#ffb35c').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
}
function litAt(x, y){ return S.lights.some(l => Math.hypot(x - l.x, y - l.y) <= l.dim && pointInPoly(x, y, l.poly)); }
function pointSeen(x, y){
  return S.visInfo.some(v => pointInPoly(x, y, v.poly) && (!S.needLight || Math.hypot(x - v.x, y - v.y) <= v.dv || litAt(x, y)));
}
function tokenVisibleToPlayers(t){
  if (t.type === 'pc') return !t.hidden;
  if (t.hidden) return false;
  if (!playerFogActive()) return true;
  if (!S.visInfo.length) return false;
  return pointSeen(t.x, t.y);
}

/* ============ imágenes de token ============ */
const imgCache = {};
function tokenImage(t){
  const url = t.imgUrl || null;
  if (!url) return null;
  let c = imgCache[url];
  if (!c){
    c = new Image();
    c.crossOrigin = 'anonymous';
    c.onload = () => needsDraw();
    c.src = url;
    imgCache[url] = c;
  }
  return (c.complete && c.naturalWidth) ? c : null;
}
async function shrinkImage(file, max){
  max = max || 256;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.85));
    return blob || file;
  } catch(e){ return file; }
}

/* ============ dibujo ============ */
function draw(){
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#0b0908'; ctx.fillRect(0, 0, cv.width, cv.height);
  const m = activeMap();
  if (!m || !S.gameId){ const ph = $('#pickHint'); if (ph) ph.style.display = 'none'; return; }
  if (S.fogDirty) recomputeFog();
  ctx.save();
  ctx.translate(S.cam.x, S.cam.y); ctx.scale(S.cam.s, S.cam.s);
  if (S.media.video) ctx.drawImage(S.media.video, 0, 0, S.media.w, S.media.h);
  else if (S.media.img) ctx.drawImage(S.media.img, 0, 0, S.media.w, S.media.h);
  else { ctx.fillStyle = '#1a150f'; ctx.fillRect(0, 0, S.media.w || 2000, S.media.h || 1400); }
  const g = gridOf(m);
  if (S.showGrid && m.showGrid !== false){
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1 / S.cam.s;
    ctx.beginPath();
    const ox = (m.gridOffX || 0) % g, oy = (m.gridOffY || 0) % g;
    for (let x = ox; x <= S.media.w; x += g){ ctx.moveTo(x, 0); ctx.lineTo(x, S.media.h); }
    for (let y = oy; y <= S.media.h; y += g){ ctx.moveTo(0, y); ctx.lineTo(S.media.w, y); }
    ctx.stroke();
  }
  const fogOn = playerFogActive();
  const needPick = !S.isDM && fogOn && m.sharedVision !== true && !myToken(m.id);
  const ph = $('#pickHint');
  if (ph){
    ph.style.display = needPick ? '' : 'none';
    const elsewhere = needPick && myPC();
    if (ph.dataset.mode !== (elsewhere ? 'e' : 'p')){
      ph.dataset.mode = elsewhere ? 'e' : 'p';
      if (!ph.dataset.orig) ph.dataset.orig = ph.innerHTML;
      ph.innerHTML = elsewhere ? '<div style="font:700 17px Cinzel,serif; color:var(--accent)">🧭 Tu personaje está en otro mapa</div><div class="muted" style="margin-top:6px">El DM te traerá aquí cuando toque.</div>' : ph.dataset.orig;
    }
  }
  const toks = gameTokens(m.id);
  const seeAll = S.isDM && !S.viewAsPlayer;
  toks.filter(t => t.type !== 'pc').forEach(t => {
    if (seeAll || tokenVisibleToPlayers(t)) drawToken(t, m, seeAll && t.hidden);
  });
  drawDoors(m, g);
  if (fogReady && mapDarkness(m) > 0.01){
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(glowCanvas, 0, 0, S.media.w, S.media.h); ctx.restore();
    ctx.globalAlpha = (S.isDM && !S.viewAsPlayer) ? 0.55 : 1;
    ctx.drawImage(darkCanvas, 0, 0, S.media.w, S.media.h);
    ctx.globalAlpha = 1;
  }
  if (fogOn){
    if (fogReady) ctx.drawImage(fogCanvas, 0, 0, S.media.w, S.media.h);
    else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S.media.w, S.media.h); }
  } else if (S.isDM && m.fog !== false && S.viewAsPlayer === false){
    ctx.globalAlpha = 0.22;
    ctx.drawImage(fogCanvas, 0, 0, S.media.w, S.media.h);
    ctx.globalAlpha = 1;
  }
  const ms = moveState();
  S.reach = ms ? reachableCells(ms) : [];
  if (S.reach.length){
    const half = g / 2;
    ctx.fillStyle = 'rgba(201,162,39,0.30)'; ctx.strokeStyle = 'rgba(255,214,90,0.9)'; ctx.lineWidth = 2 / S.cam.s;
    S.reach.forEach(c => { ctx.fillRect(c.x - half + 2, c.y - half + 2, g - 4, g - 4); ctx.strokeRect(c.x - half + 2, c.y - half + 2, g - 4, g - 4); });
  }
  drawTemplates(m, g);
  toks.filter(t => t.type === 'pc' && (!t.hidden || seeAll)).forEach(t => drawToken(t, m, seeAll && t.hidden));
  if (S.isDM && S.showWalls) drawLightMarkers(m, g);
  if (S.isDM && S.showWalls){
    ctx.lineWidth = 3 / S.cam.s;
    wallSegs(m, false).forEach(s => {
      if (s.i == null) return;
      const w = m.walls[s.i];
      ctx.strokeStyle = w.door ? '#e0b43c' : '#d8452e';
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    });
    const ds = m.doorStates || {};
    (m.walls || []).forEach((w, i) => {
      if (w.door && ds[i]){
        ctx.strokeStyle = 'rgba(224,180,60,.45)';
        ctx.beginPath(); ctx.moveTo(w.x1 + (m.wallOffX || 0), w.y1 + (m.wallOffY || 0)); ctx.lineTo(w.x2 + (m.wallOffX || 0), w.y2 + (m.wallOffY || 0)); ctx.stroke();
      }
    });
  }
  const now = performance.now();
  if (S.isDM && !S.viewAsPlayer && !S.projector && m.spawn){
    const g = gridOf(m);
    ctx.save();
    ctx.fillStyle = 'rgba(201,162,39,.18)'; ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.arc(m.spawn.x, m.spawn.y, g * 1.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]); ctx.font = Math.round(g * 0.7) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🚩', m.spawn.x, m.spawn.y);
    ctx.restore();
  }
  S.pings = S.pings.filter(p => now - p.t < 2000);
  S.pings.forEach(p => {
    const k = (now - p.t) / 2000;
    ctx.strokeStyle = 'rgba(201,162,39,' + (1 - k) + ')';
    ctx.lineWidth = 4 / S.cam.s;
    ctx.beginPath(); ctx.arc(p.x, p.y, 10 + k * g * 1.6, 0, Math.PI * 2); ctx.stroke();
  });
  if (S.pings.length) needsDraw();
  drawRulers(m, g);
  ctx.restore();
  sendCamToProjector();
}
function drawDoors(m, g){
  const ds = m.doorStates || {};
  (m.walls || []).forEach((w, i) => {
    if (!w.door) return;
    const x = (w.x1 + w.x2) / 2 + (m.wallOffX || 0), y = (w.y1 + w.y2) / 2 + (m.wallOffY || 0);
    const open = !!ds[i];
    const r = Math.max(10, g * 0.18);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = open ? 'rgba(80,140,70,.92)' : 'rgba(150,100,40,.95)';
    ctx.strokeStyle = '#0008'; ctx.lineWidth = 2 / S.cam.s;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold ' + (r * 1.1) + 'px Inter';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(open ? '🚪' : '🔒', 0, 1);
    ctx.restore();
  });
}
function drawToken(t, m, ghost){
  const g = gridOf(m);
  const r = (t.size || 1) * g / 2 * 0.92;
  let x = t.x, y = t.y;
  if (S.drag && S.drag.tokenId === t.id){ x = S.drag.curX; y = S.drag.curY; }
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.45;
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath(); ctx.ellipse(x + r * 0.08, y + r * 0.12, r, r * 0.92, 0, 0, Math.PI * 2); ctx.fill();
  const im = tokenImage(t);
  if (im){
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    const k = Math.max((2 * r) / im.naturalWidth, (2 * r) / im.naturalHeight);
    ctx.drawImage(im, x - im.naturalWidth * k / 2, y - im.naturalHeight * k / 2, im.naturalWidth * k, im.naturalHeight * k);
    ctx.restore();
    ctx.lineWidth = Math.max(2, g * 0.05);
    ctx.strokeStyle = t.color || '#555';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.fillStyle = t.color || '#555';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 ' + (r * 0.85) + 'px Inter';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((t.name || '?').trim().charAt(0).toUpperCase(), x, y + 1);
  }
  ctx.lineWidth = Math.max(2, g * 0.045);
  ctx.strokeStyle = t.type === 'pc' ? '#e8ddc8' : (t.type === 'npc' ? '#7fb3d5' : '#1a1109');
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  if (ghost){ ctx.setLineDash([6, 5]); ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
  if (t.hpMax > 0){
    const pct = clamp((t.hp || 0) / t.hpMax, 0, 1);
    ctx.lineWidth = Math.max(3, g * 0.07);
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath(); ctx.arc(x, y, r + ctx.lineWidth * 0.8, -Math.PI / 2, Math.PI * 1.5); ctx.stroke();
    ctx.strokeStyle = pct > 0.5 ? '#4e8c4a' : (pct > 0.25 ? '#c9a227' : '#b4422e');
    ctx.beginPath(); ctx.arc(x, y, r + ctx.lineWidth * 0.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct); ctx.stroke();
  }
  ctx.font = '600 ' + Math.max(11, g * 0.22) + 'px Inter';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(t.name || '').width;
  ctx.fillStyle = 'rgba(0,0,0,.65)';
  ctx.fillRect(x - tw / 2 - 5, y + r + 4, tw + 10, g * 0.3);
  ctx.fillStyle = '#fff';
  ctx.fillText(t.name || '', x, y + r + 4 + g * 0.15);
  if (t.burning){
    ctx.font = (r * 0.8) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🔥', x + r * 0.75, y - r * 0.75);
  }
  const c = (gameDoc() || {}).combat;
  if (c && c.active && c.entries[c.turn] && c.entries[c.turn].tokenId === t.id){
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = Math.max(2.5, g * 0.05);
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.arc(x, y, r + g * 0.16, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/* ============ interacción canvas ============ */
const pointers = new Map();
let pinchStart = null;
function canMoveToken(t){ return S.isDM && !S.projector; }
function hitToken(mx, my){
  const m = activeMap(); if (!m) return null;
  const g = gridOf(m);
  const seeAll = S.isDM && !S.viewAsPlayer;
  const list = gameTokens(m.id)
    .filter(t => seeAll || (t.type === 'pc' ? !t.hidden : tokenVisibleToPlayers(t)))
    .sort((a, b) => (a.size || 1) - (b.size || 1));
  for (const t of list){
    const r = (t.size || 1) * g / 2;
    if (Math.hypot(mx - t.x, my - t.y) <= r) return t;
  }
  return null;
}
function hitDoor(mx, my){
  const m = activeMap(); if (!m) return null;
  const g = gridOf(m);
  const walls = m.walls || [];
  for (let i = 0; i < walls.length; i++){
    const w = walls[i]; if (!w.door) continue;
    const x = (w.x1 + w.x2) / 2 + (m.wallOffX || 0), y = (w.y1 + w.y2) / 2 + (m.wallOffY || 0);
    if (Math.hypot(mx - x, my - y) <= Math.max(12, g * 0.22)) return i;
  }
  return null;
}
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2){
    const pts = [...pointers.values()];
    pinchStart = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), s: S.cam.s, cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2, camx: S.cam.x, camy: S.cam.y };
    S.drag = null; S.pan = null; S.tplDraft = null; if (S.ruler) S.ruler.down = false;
    $('#distLabel').style.display = 'none';
    return;
  }
  const rect = cv.getBoundingClientRect();
  const p = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
  if (S.rulerMode && activeMap()){ rulerDown(p); return; }
  if (S.tplMode && activeMap()){ tplDown(p); return; }
  if (S.pickSpawn && S.isDM && !S.projector){
    const m = activeMap();
    if (m){
      const g = gridOf(m), sp = { x: Math.floor(p.x / g) * g + g / 2, y: Math.floor(p.y / g) * g + g / 2 };
      DB.doc('maps/' + m.id).update({ spawn: sp }).then(() => toast('🚩 Punto de aparición de «' + m.name + '» guardado')).catch(err => toast(err.message, true));
    }
    setSpawnMode(false);
    return;
  }
  if (S.isDM && !S.projector && S.showWalls){
    const li = hitLight(p.x, p.y);
    if (li !== null){
      const m = activeMap();
      const lo = Object.assign({}, m.lightsOff || {});
      if (lo[li]) delete lo[li]; else lo[li] = true;
      DB.doc('maps/' + m.id).update({ lightsOff: lo }).then(() => toast(lo[li] ? '💡 Luz apagada' : '💡 Luz encendida')).catch(err => toast(err.message, true));
      return;
    }
  }
  if (S.isDM && !S.projector){
    const di = hitDoor(p.x, p.y);
    if (di !== null){
      const m = activeMap();
      const ds = Object.assign({}, m.doorStates || {});
      ds[di] = !ds[di];
      DB.doc('maps/' + m.id).update({ doorStates: ds }).catch(() => {});
      S.fogDirty = true; needsDraw();
      return;
    }
  }
  const t = hitToken(p.x, p.y);
  if (t && canMoveToken(t)){
    S.drag = { tokenId: t.id, startX: t.x, startY: t.y, curX: t.x, curY: t.y, moved: false };
    cv.classList.add('dragging');
  } else {
    S.pan = { sx: e.clientX, sy: e.clientY, camx: S.cam.x, camy: S.cam.y };
    cv.classList.add('dragging');
  }
});
cv.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinchStart && pointers.size === 2){
    const pts = [...pointers.values()];
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const k = d / pinchStart.d;
    const ns = clamp(pinchStart.s * k, 0.04, 6);
    const rect = cv.getBoundingClientRect();
    const cx = pinchStart.cx - rect.left, cy = pinchStart.cy - rect.top;
    S.cam.x = cx - (cx - pinchStart.camx) * (ns / pinchStart.s);
    S.cam.y = cy - (cy - pinchStart.camy) * (ns / pinchStart.s);
    S.cam.s = ns; needsDraw();
    return;
  }
  const rect = cv.getBoundingClientRect();
  if (S.rulerMode){ rulerMove(screenToMap(e.clientX - rect.left, e.clientY - rect.top), e.pointerType === 'mouse'); return; }
  if (S.tplDraft){ tplMove(screenToMap(e.clientX - rect.left, e.clientY - rect.top), e.clientX - rect.left, e.clientY - rect.top); return; }
  if (S.drag){
    const p = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
    S.drag.curX = p.x; S.drag.curY = p.y; S.drag.moved = true;
    const m = activeMap();
    if (m){
      const g = gridOf(m);
      const cells = Math.max(Math.abs(Math.round((p.x - S.drag.startX) / g)), Math.abs(Math.round((p.y - S.drag.startY) / g)));
      const lbl = $('#distLabel');
      lbl.style.display = 'block';
      lbl.style.left = (e.clientX - rect.left + 14) + 'px';
      lbl.style.top = (e.clientY - rect.top - 26) + 'px';
      lbl.textContent = cells + ' casillas · ' + (cells * 5) + ' ft';
    }
    needsDraw();
  } else if (S.pan){
    S.cam.x = S.pan.camx + (e.clientX - S.pan.sx);
    S.cam.y = S.pan.camy + (e.clientY - S.pan.sy);
    needsDraw();
  }
});
function endPointer(e){
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  $('#distLabel').style.display = 'none';
  cv.classList.remove('dragging');
  if (S.rulerMode && S.ruler && S.ruler.down){ rulerUp(e.type === 'pointerup'); return; }
  if (S.tplDraft){ tplUp(e.type === 'pointerup'); return; }
  if (S.drag){
    const d = S.drag; S.drag = null;
    const t = S.tokens[d.tokenId]; const m = activeMap();
    if (t && m && d.moved){
      const sn = snapToken(m, t, d.curX, d.curY);
      t.x = sn.x; t.y = sn.y; S.fogDirty = true; needsDraw();
      DB.doc('tokens/' + t.id).update({ x: sn.x, y: sn.y }).catch(err => toast('No se pudo mover el token: ' + (err.message || err), true));
    } else needsDraw();
  }
  if (S.pan && e.type === 'pointerup' && Math.hypot(e.clientX - S.pan.sx, e.clientY - S.pan.sy) < 8) handleTap(e);
  S.pan = null;
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = cv.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const k = e.deltaY < 0 ? 1.13 : 1 / 1.13;
  const ns = clamp(S.cam.s * k, 0.04, 6);
  S.cam.x = mx - (mx - S.cam.x) * (ns / S.cam.s);
  S.cam.y = my - (my - S.cam.y) * (ns / S.cam.s);
  S.cam.s = ns; needsDraw();
}, { passive: false });
cv.addEventListener('dblclick', e => {
  if (S.rulerMode || S.tplMode) return;
  const rect = cv.getBoundingClientRect();
  const p = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
  S.pings.push({ x: p.x, y: p.y, t: performance.now() });
  needsDraw();
  if (GCH){ try { GCH.send({ type: 'broadcast', event: 'ping', payload: { x: p.x, y: p.y } }); } catch(err){} }
});

$('#btnZoomIn').onclick = () => { S.cam.s = clamp(S.cam.s * 1.25, 0.04, 6); needsDraw(); };
$('#btnZoomOut').onclick = () => { S.cam.s = clamp(S.cam.s / 1.25, 0.04, 6); needsDraw(); };
// ⛶: para el jugador alterna entre su PJ y el mapa entero
$('#btnFit').onclick = () => fitView(!S.isDM && S.camFocus);
$('#btnGrid').onclick = () => { S.showGrid = !S.showGrid; needsDraw(); };
$('#btnWalls').onclick = () => { S.showWalls = !S.showWalls; $('#btnWalls').style.borderColor = S.showWalls ? 'var(--accent)' : ''; renderPanel(); needsDraw(); };
$('#btnFog').onclick = () => {
  const m = activeMap(); if (!m) return;
  DB.doc('maps/' + m.id).update({ fog: m.fog === false }).then(() => toast(m.fog === false ? 'Niebla activada' : 'Niebla desactivada')).catch(() => {});
};
$('#btnViewAs').onclick = () => {
  S.viewAsPlayer = !S.viewAsPlayer;
  $('#btnViewAs').innerHTML = S.viewAsPlayer ? '<span class="ic">👑</span><span class="lbl">Volver a vista DM</span>' : '<span class="ic">👁</span><span class="lbl">Ver como jugador</span>';
  S.fogDirty = true; needsDraw();
};
$('#sidebarToggle').onclick = () => { document.body.classList.toggle('side-hidden'); setTimeout(resizeCanvas, 220); };
$('#btnMapSize').onclick = () => {
  const b = document.body.classList;
  if (b.contains('map-big')){ b.remove('map-big'); b.add('map-small'); }
  else if (b.contains('map-small')) b.remove('map-small');
  else b.add('map-big');
  $('#btnMapSize').textContent = b.contains('map-big') ? '⤡ Panel' : b.contains('map-small') ? '⤢ Mapa' : '⤢ Mapa';
  setTimeout(resizeCanvas, 220);
};
try { new ResizeObserver(() => resizeCanvas()).observe($('#stage')); } catch(e){}
/* Móvil: ocultar el mapa para que el panel ocupe toda la pantalla (se recuerda en este dispositivo) */
function mapHidden(){ return document.body.classList.contains('map-hidden'); }
function setMapHidden(h){
  document.body.classList.toggle('map-hidden', !!h);
  lsSet('vtt_map_hidden', h ? 1 : null);
  $('#btnHideMap').innerHTML = '🗺<span class="lbl"> ' + (h ? 'Ver mapa' : 'Ocultar mapa') + '</span>';
  $('#btnHideMap').setAttribute('aria-pressed', h ? 'true' : 'false');
  $('#btnHideMap').title = h ? 'Mostrar el mapa' : 'Ocultar el mapa para tener más espacio para el panel';
  if (!h) resizeCanvas();
}
$('#btnHideMap').onclick = () => setMapHidden(!mapHidden());
setMapHidden(!!lsGet('vtt_map_hidden'));

/* ============ rondas libres, ficha de PJ, inventario, QR ============ */
async function rpc(name, args){
  if (S.localMode || !SB) throw new Error('Necesitas conexión con el servidor para esta acción');
  const { data, error } = await SB.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
function moveState(){
  const m = activeMap(); if (!m || S.isDM || S.projector) return null;
  const mine = myToken(m.id); if (!mine) return null;
  const rd = (gameDoc() || {}).round || {};
  if (!rd.active || (rd.done || {})[mine.id]) return null;
  const r = (rd.pending || {})[mine.id]; if (!r) return null;
  return { m, mine, r };
}
function segCross(ax, ay, bx, by, s){
  const d = (bx - ax) * (s.y2 - s.y1) - (by - ay) * (s.x2 - s.x1);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((s.x1 - ax) * (s.y2 - s.y1) - (s.y1 - ay) * (s.x2 - s.x1)) / d;
  const u = ((s.x1 - ax) * (by - ay) - (s.y1 - ay) * (bx - ax)) / d;
  return t > 0.001 && t < 0.999 && u > -0.001 && u < 1.001;
}
function reachableCells(ms){
  const g = gridOf(ms.m), r = ms.r, me = ms.mine;
  const segs = wallSegs(ms.m, false);
  const occ = gameTokens(ms.m.id).filter(t => t.id !== me.id && !(t.hidden && t.type === 'monster'));
  const out = [];
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++){
    if (!dx && !dy) continue;
    const x = me.x + dx * g, y = me.y + dy * g;
    if (x < 0 || y < 0 || x > (S.media.w || 1e9) || y > (S.media.h || 1e9)) continue;
    if (occ.some(t => Math.abs(t.x - x) < g / 2 && Math.abs(t.y - y) < g / 2)) continue;
    if (segs.some(s => segCross(me.x, me.y, x, y, s))) continue;
    out.push({ x, y });
  }
  return out;
}
async function handleTap(e){
  if (!S.reach.length || S.busy) return;
  const ms = moveState(); if (!ms) return;
  const rect = cv.getBoundingClientRect();
  const p = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
  const g = gridOf(ms.m);
  const c = S.reach.find(c => Math.abs(p.x - c.x) <= g / 2 && Math.abs(p.y - c.y) <= g / 2);
  if (!c) return;
  S.busy = true;
  try {
    const r = await rpc('round_move_commit', { tid: ms.mine.id, nx: c.x, ny: c.y });
    toast('🏃 ¡Movido! Has terminado tu acción de esta ronda.');
    ((r && r.reactions) || []).forEach((x, i) => setTimeout(() => toast(reactionText(x), !!x.hit), 700 * (i + 1)));
  }
  catch(err){ toast(err.message, true); }
  S.busy = false;
}
function attackOptions(t){
  const list = (S.attacks || []).filter(a => a.cls === t.cls);
  const out = [];
  if (t.wpn && t.wpn.name) out.push({ id: 'weapon', name: '🗡 ' + t.wpn.name, lvl: 1, range: t.wpn.range || 1, dmg: t.wpn.dmg,
    atk_bonus: (t.wpn.atk || 0) - (t.atk || 0), descr: 'Arma equipada · +' + (t.wpn.atk || 0) + ' al ataque (' + (t.wpn.abil || 'Fue') + ')' });
  if (!list.length && !out.length) out.push({ id: 'basic', name: 'Ataque básico', lvl: 1, range: t.range || 1, dmg: t.dmg || '1d6', atk_bonus: 0, descr: '' });
  return out.concat(list);
}
function abilHtml(t){
  const base = Object.assign({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, t.abil || CLASS_ABIL[t.cls] || {});
  const eff = Object.assign({}, base, t.abilEff || {});
  return '<div class="abil-row">' + ABILS.map(([k, lab]) =>
    '<div class="abil' + (eff[k] > base[k] ? ' up' : '') + '" title="' + (eff[k] > base[k] ? 'Mejorada por un objeto (base ' + base[k] + ')' : '') + '"><span>' + lab + '</span><b>' + eff[k] + '</b><i>' + abMod(eff[k]) + '</i></div>').join('') + '</div>';
}
function eqSummary(eq){
  if (!eq) return '';
  const p = [];
  if (eq.slot === 'armor') p.push('Armadura: CA ' + eq.ac + (eq.dex === 'full' ? ' + Des' : eq.dex === 'max2' ? ' + Des (máx. 2)' : '') + (eq.str ? ' · Fue ' + eq.str : '') + (eq.stealth ? ' · desventaja en Sigilo' : ''));
  if (eq.slot === 'shield') p.push('Escudo: +' + eq.ac + ' CA');
  if (eq.slot === 'weapon') p.push('Arma: ' + eq.dice + ' ' + (eq.dtype || '') + (eq.bonus ? ' · +' + eq.bonus : '') + ' · alcance ' + (eq.range || 1) + (eq.finesse ? ' · sutil' : '') + (eq.ranged ? ' · a distancia (Des)' : '') + (eq.twoh ? ' · a dos manos' : ''));
  if (eq.slot === 'acc'){
    if (eq.ac) p.push('+' + eq.ac + ' CA' + (eq.needArmor ? ' (con armadura)' : '') + (eq.needShield ? ' (con escudo)' : '') + (eq.noArmor ? ' (sin armadura ni escudo)' : ''));
    if (eq.watk) p.push('+' + eq.watk + ' ataque y daño con tu arma');
    if (eq.wextra) p.push('+' + eq.wextra + ' de daño con tu arma');
    if (eq.set) p.push(Object.entries(eq.set).map(([k, v]) => (ABILS.find(a => a[0] === k) || [k, k])[1] + ' ' + v).join(', '));
    if (!p.length) p.push('Accesorio (efecto narrativo)');
  }
  if (eq.attune) p.push('requiere sintonía (máx. 3)');
  return '🛡 ' + p.join(' · ');
}
function equipHtml(t){
  const items = (t.inventory && t.inventory.items) || [];
  const worn = items.filter(i => i.equipped && i.itemId && S.itemById[i.itemId] && S.itemById[i.itemId].eq);
  const bySlot = s => worn.filter(i => S.itemById[i.itemId].eq.slot === s);
  const nm = arr => arr.length ? arr.map(i => esc(i.name)).join(', ') : '<span class="muted">—</span>';
  const w = t.wpn || {};
  return '<div class="section-title">🛡 Equipo puesto</div><div class="card">' +
    '<div class="eq-row"><span class="k">CA</span><span class="v"><b style="font-size:16px">' + (t.ac || '—') + '</b>' + (t.acParts ? '<div class="mini">' + esc(t.acParts) + '</div>' : '') + '</span></div>' +
    '<div class="eq-row"><span class="k">Armadura</span><span class="v">' + nm(bySlot('armor')) + '</span></div>' +
    '<div class="eq-row"><span class="k">Escudo</span><span class="v">' + nm(bySlot('shield')) + '</span></div>' +
    '<div class="eq-row"><span class="k">Arma</span><span class="v">' + (w.name ? esc(w.name) + '<div class="mini">+' + (w.atk || 0) + ' al ataque · ' + esc(w.dmg || '') + ' ' + esc(w.dtype || '') + ' · alcance ' + (w.range || 1) + '</div>' : nm(bySlot('weapon'))) + '</span></div>' +
    '<div class="eq-row"><span class="k">Accesorios</span><span class="v">' + nm(bySlot('acc')) + '<div class="mini">Sintonía ' + (t.attuned || 0) + '/3</div></span></div>' +
    (t.eqWarn ? '<div class="note-warn">⚠ ' + esc(t.eqWarn) + '</div>' : '') +
    '<div class="mini" style="margin-top:4px">Toca un objeto del inventario y pulsa «Equipar». Queda guardado.</div></div>';
}
function fxTag(cat){
  const fx = cat && cat.fx;
  if (!fx || fx.t === 'note') return cat && cat.consumable ? '<span class="fx-tag" style="color:var(--ink-dim)">narrativo</span>' : '';
  if (fx.t === 'heal') return '<span class="fx-tag">⚡ cura ' + esc(fx.dice) + '</span>';
  return '<span class="fx-tag">⚡ ' + esc(fx.dice) + ' ' + esc(fx.dtype || '') + (fx.mode === 'save' ? ' · salv. Des' : fx.mode === 'auto' ? ' · impacta siempre' : '') + '</span>';
}
function xpBarHtml(t){
  const xp = t.xp || 0, l = levelOf(t);
  if (l >= 10) return '<div class="mini" style="margin-top:8px">⭐ ' + xp + ' XP · nivel máximo</div>';
  const a = XP_LEVELS[l - 1], b = XP_LEVELS[l];
  const pct = clamp((xp - a) / (b - a) * 100, 0, 100);
  return '<div class="row between" style="margin-top:8px"><span class="mini">⭐ ' + xp + ' XP</span><span class="mini">nivel ' + (l + 1) + ' a ' + b + '</span></div><div class="xpbar"><i style="width:' + pct + '%"></i></div>';
}
function reactionText(x){
  return '👹 ' + x.monster + ' ' + (x.reason === 'contraataque' ? 'contraataca' : 'te ve y ataca') + ': ' +
    (x.crit ? '¡CRÍTICO! ' + x.dmg + ' de daño' : x.hit ? x.dmg + ' de daño' : 'falla') +
    (x.hit ? ' (te quedan ' + x.hp + ' PV)' : '') + (x.hit && x.hp <= 0 ? ' 💀' : '');
}
function dmSetHp(t, hp){
  if (t.type === 'monster' && hp <= 0){
    DB.doc('tokens/' + t.id).delete().then(() => toast('💀 ' + t.name + ' ha muerto')).catch(e => toast(e.message || e, true));
    return;
  }
  DB.doc('tokens/' + t.id).update({ hp: Math.max(0, hp) }).catch(() => {});
}
function avatarStyle(t){
  return safeUrl(t.imgUrl) ? 'background-image:url(' + esc(safeUrl(t.imgUrl)) + ')' : 'background:' + esc(t.color || '#555');
}
function renderPjPanel(p){
  const m = activeMap();
  const mine = myPC();
  let html = '';
  if (!mine){
    const free = gamePCs().filter(t => !t.hidden && !t.ownerId);
    html += '<div class="section-title">Elige tu personaje</div>';
    if (!free.length) html += '<div class="muted">No hay personajes libres. Pide al DM que cree tu PJ (tipo «Personaje»).</div>';
    free.forEach(t => {
      html += '<div class="card"><div class="row between"><div class="row"><div class="sheet-av" style="width:44px;height:44px;font-size:18px;' + avatarStyle(t) + '">' + (t.imgUrl ? '' : esc((t.name || '?').charAt(0).toUpperCase())) + '</div>' +
        '<div><b>' + esc(t.name) + '</b><div class="mini">' + esc(raceCls(t)) + '</div></div></div>' +
        '<button class="primary small t-claim" data-tid="' + t.id + '">Este es mi personaje</button></div></div>';
    });
    p.innerHTML = html; bindTokenPanel(); return;
  }
  const onMap = !!(m && mine.mapId === m.id);
  const g = m ? gridOf(m) : 70;
  if (!mine.acParts && !S.recalcAsked[mine.id] && !S.localMode){
    S.recalcAsked[mine.id] = true;
    rpc('token_recalc', { tid: mine.id }).catch(() => {});
  }
  const rd = (gameDoc() || {}).round || {};
  const hpPct = mine.hpMax > 0 ? clamp((mine.hp || 0) / mine.hpMax * 100, 0, 100) : 0;
  // Ficha
  const sheetAt = html.length;
  html += '<div class="card"><div class="sheet-head"><div class="sheet-av" style="' + avatarStyle(mine) + '">' + (mine.imgUrl ? '' : esc((mine.name || '?').charAt(0).toUpperCase())) + '</div>' +
    '<div class="grow"><div style="font:800 19px Cinzel,serif">' + esc(mine.name) + '</div><div class="muted">' + esc(raceCls(mine)) + '</div>' +
    (mine.hpMax > 0 ? '<div class="hpbar"><i style="width:' + hpPct + '%"></i></div>' : '') + '</div></div>' +
    '<div class="stat-row"><div class="stat"><b>' + (mine.hp || 0) + '/' + (mine.hpMax || 0) + '</b><span>PV</span></div>' +
    '<div class="stat"><b>' + (mine.ac || '—') + '</b><span>CA</span></div>' +
    '<div class="stat"><b>' + levelOf(mine) + '</b><span>Nivel</span></div>' +
    '<div class="stat"><b>+' + (mine.pb || (2 + Math.floor((levelOf(mine) - 1) / 4))) + '</b><span>Compet.</span></div></div>' +
    abilHtml(mine) +
    xpBarHtml(mine) +
    '<div class="row between" style="margin-top:8px"><span class="mini">Movimiento: ' + esc(mine.moveDie || '1d6') + '</span><button class="small" id="btnRelease">Cambiar de PJ</button></div></div>';
  html += equipHtml(mine);
  const turnAt = html.length;
  // Ronda
  const ko = mine.hpMax > 0 && (mine.hp || 0) <= 0;
  const myMove = rd.active && onMap && !ko && !(rd.done || {})[mine.id];
  html += '<div class="section-title' + (myMove ? ' turn-now' : '') + '">' + (myMove ? '⚔ Te toca actuar' : 'Tu turno') + '</div><div class="card' + (myMove ? ' turn-now' : '') + '">';
  if (!onMap){
    const where = mine.mapId && S.maps[mine.mapId] ? '«' + esc(S.maps[mine.mapId].name) + '»' : 'el banquillo (fuera de cualquier mapa)';
    html += '<div class="muted">🧭 Tu personaje está en ' + where + '. ' + (m ? 'El DM te traerá a este mapa cuando llegue el momento.' : 'El DM aún no ha activado ningún mapa.') + '</div>';
  } else if (ko){
    html += '<div class="ko">💀 Estás inconsciente.</div><div class="muted" style="margin-top:4px">No puedes actuar hasta que alguien te cure o el DM te devuelva PV.</div>';
  } else if (!rd.active){
    html += '<div class="muted">⏳ Esperando a que el DM abra la ronda.</div>';
  } else {
    const done = (rd.done || {})[mine.id], pend = (rd.pending || {})[mine.id];
    html += '<div class="row between"><b>Ronda ' + (rd.n || 1) + '</b>' + (done ? '<span class="round-pill done">✓ ' + ACTION_LABEL[done] + '</span>' : '<span class="round-pill wait">Te toca</span>') + '</div>';
    if (done) html += '<div class="muted" style="margin-top:6px">Ya has actuado. Espera a que el DM pase de ronda.</div>';
    else if (pend) html += '<div style="margin-top:8px">🎲 Has sacado <b style="font-size:20px;color:var(--accent)">' + pend + '</b> casillas.<br><b>Toca una casilla iluminada del mapa</b> para moverte.</div>';
    html += '<div class="act-grid">' +
      '<button id="actMove"' + (done || pend || ko ? ' disabled' : '') + '><span class="ic">🎲</span>Movimiento</button>' +
      '<button id="actAtk"' + (done || pend || ko ? ' disabled' : '') + (S.attackPick ? ' class="primary"' : '') + '><span class="ic">⚔</span>Atacar</button>' +
      '<button id="actPass"' + (done || ko ? ' disabled' : '') + '><span class="ic">⏭</span>Pasar</button></div>';
    if (S.attackPick && !done && !pend){
      const opts = attackOptions(mine);
      const lvl = levelOf(mine);
      if (!S.atkSel || !opts.some(o => o.id === S.atkSel && o.lvl <= lvl)) S.atkSel = (opts.find(o => o.lvl <= lvl) || {}).id || null;
      html += '<div class="mini" style="margin-top:10px">1. Elige ataque:</div>';
      opts.forEach(o => {
        const locked = o.lvl > lvl;
        html += '<div class="atk-opt' + (o.id === S.atkSel ? ' sel' : '') + (locked ? ' locked' : '') + '" data-aid="' + esc(o.id) + '"' + (locked ? ' data-locked="1"' : '') + '>' +
          '<div><b>' + (locked ? '🔒 ' : '') + esc(o.name) + '</b><div class="meta">' + esc(o.dmg) + ' · alcance ' + o.range + (o.atk_bonus ? ' · ' + (o.atk_bonus > 0 ? '+' : '') + o.atk_bonus + ' al ataque' : '') + (o.descr ? ' · ' + esc(o.descr) : '') + '</div></div>' +
          '<span class="mini">' + (locked ? 'Nivel ' + o.lvl : (o.id === S.atkSel ? '✓' : '')) + '</span></div>';
      });
      const selA = opts.find(o => o.id === S.atkSel) || { range: mine.range || 1, name: 'Ataque básico' };
      const rng = selA.range || 1;
      const tg = gameTokens(m.id).filter(t => t.type === 'monster' && !t.hidden && tokenVisibleToPlayers(t))
        .map(t => ({ t, d: Math.round(Math.max(Math.abs(t.x - mine.x), Math.abs(t.y - mine.y)) / g) }))
        .sort((a, b) => a.d - b.d);
      html += '<div class="mini" style="margin-top:10px">2. Elige objetivo (alcance de ' + esc(selA.name) + ': ' + rng + ' casilla' + (rng > 1 ? 's' : '') + '):</div>';
      if (!tg.length) html += '<div class="muted" style="margin-top:4px">No ves ningún enemigo.</div>';
      tg.forEach(({ t, d }) => {
        const ok = d <= rng;
        html += '<div class="tgt"><div><b>' + esc(t.name) + '</b> <span class="mini">a ' + d + ' casilla' + (d === 1 ? '' : 's') + '</span></div>' +
          '<button class="small ' + (ok ? 'primary ' : '') + 'atk-go" data-tid="' + t.id + '"' + (ok ? '' : ' disabled') + '>' + (ok ? '⚔ Atacar' : 'Fuera de alcance') + '</button></div>';
      });
    }
  }
  html += '</div>';
  // Si hay que actuar, el turno va arriba del todo (en el móvil no hay que bajar hasta él)
  if (myMove){ const sheet = html.slice(sheetAt, turnAt), turn = html.slice(turnAt); html = html.slice(0, sheetAt) + turn + sheet; }
  // Inventario
  const inv = mine.inventory || { slots: 5, items: [] };
  const items = inv.items || [];
  const slots = Math.max(inv.slots || 5, items.length);
  html += '<div class="section-title">🎒 Inventario · ' + items.length + '/' + slots + '</div><div class="inv-grid">';
  for (let i = 0; i < slots; i++){
    const it = items[i];
    if (it) html += '<div class="slot full' + (S.invSel === it.id ? ' sel' : '') + (it.equipped ? ' eqd' : '') + '" data-iid="' + esc(it.id) + '">' + (it.equipped ? '<span class="eqm">✓ PUESTO</span>' : '') + (it.consumable ? '🧪' : '') + esc(it.name) +
      ((it.qty || 1) > 1 ? '<span class="q">×' + it.qty + '</span>' : '') + '</div>';
    else html += '<div class="slot"></div>';
  }
  html += '</div>';
  const sel = items.find(it => it.id === S.invSel);
  if (sel){
    const cat = sel.itemId ? S.itemById[sel.itemId] : findItem(sel.name);
    const fx = (cat && cat.fx) || sel.fx || { t: 'note' };
    const rd2 = (gameDoc() || {}).round || {};
    const canAct = onMap && rd2.active && !(rd2.done || {})[mine.id] && !(rd2.pending || {})[mine.id] && !ko;
    const eqd = cat && cat.eq ? cat.eq : null;
    const useLbl = fx.t === 'heal' ? '🧪 Beber (acción adicional)' : fx.t === 'dmg' ? '💥 Usar contra…' : (sel.consumable ? 'Usar (efecto narrativo)' : 'Mostrar al grupo');
    html += '<div class="card" style="margin-top:8px"><b>' + esc(sel.name) + '</b>' + ((sel.qty || 1) > 1 || (fx.keep) ? ' ×' + (sel.qty || 0) + (fx.keep ? ' cargas' : '') : '') +
      (cat ? fxTag(cat) : '') +
      (cat && cat.descr ? '<div class="item-desc">' + esc(cat.descr) + '</div>' : '') +
      (fx.t === 'dmg' ? '<div class="item-desc">Gasta tu acción de la ronda · alcance ' + (fx.range || 4) + ' casillas</div>' : '') +
      (eqd ? '<div class="item-desc">' + eqSummary(eqd) + '</div>' : '') +
      (!cat ? '<div class="note-warn">⚠ Objeto personalizado (no está en el catálogo): no tiene efecto automático. El DM aplica su efecto.</div>'
            : (!eqd && fx.t === 'note' ? '<div class="note-warn">ℹ Efecto narrativo: al usarlo se registra y el DM aplica el efecto.</div>' : '')) +
      '<div class="row" style="margin-top:6px">' +
      (eqd ? '<button class="small primary" id="invEquip">' + (sel.equipped ? '🎒 Quitar' : '🛡 Equipar') + '</button>'
           : '<button class="small primary" id="invUse"' + (fx.t === 'dmg' && !canAct ? ' disabled' : '') + (ko ? ' disabled' : '') + '>' + useLbl + '</button>') +
      '<button class="small" id="invDrop"' + (sel.equipped ? ' disabled title="Quítatelo antes"' : '') + '>Tirar</button></div>' +
      (fx.t === 'dmg' && !canAct && !ko ? '<div class="mini" style="margin-top:4px">Necesitas tener tu acción de la ronda disponible.</div>' : '');
    if (fx.t === 'dmg' && S.itemTarget === sel.id && canAct){
      const rng = fx.range || 4;
      const tg = gameTokens(m.id).filter(t => t.type === 'monster' && !t.hidden && tokenVisibleToPlayers(t))
        .map(t => ({ t, d: Math.round(Math.max(Math.abs(t.x - mine.x), Math.abs(t.y - mine.y)) / g) })).sort((a, b) => a.d - b.d);
      html += '<div class="mini" style="margin-top:8px">Objetivo (alcance ' + rng + '):</div>';
      if (!tg.length) html += '<div class="muted">No ves ningún enemigo.</div>';
      tg.forEach(({ t, d }) => {
        const ok = d <= rng;
        html += '<div class="tgt"><div><b>' + esc(t.name) + '</b> <span class="mini">a ' + d + '</span></div><button class="small ' + (ok ? 'primary ' : '') + 'item-go" data-tid="' + t.id + '"' + (ok ? '' : ' disabled') + '>' + (ok ? '💥 Usar' : 'Lejos') + '</button></div>';
      });
    }
    html += '</div>';
  }
  p.innerHTML = html;
  bindTokenPanel();
  // Acciones
  // Para mover hay que tocar el mapa: si estaba oculto, se vuelve a mostrar
  if (S.phone && mapHidden() && moveState()) setMapHidden(false);
  const am = $('#actMove'); if (am) am.onclick = async () => {
    am.disabled = true;
    try {
      const r = await rpc('round_move_roll', { tid: mine.id });
      if (mapHidden()) setMapHidden(false);
      toast('🎲 ¡Has sacado ' + r + '! Toca una casilla iluminada para moverte.');
      const rc = cv.getBoundingClientRect(); S.cam.x = rc.width / 2 - mine.x * S.cam.s; S.cam.y = rc.height / 2 - mine.y * S.cam.s; needsDraw();
    } catch(e){ toast(e.message, true); am.disabled = false; }
  };
  const aa = $('#actAtk'); if (aa) aa.onclick = () => { S.attackPick = !S.attackPick; renderPanel(); };
  $$('.atk-opt').forEach(el => el.onclick = () => {
    if (el.dataset.locked){ toast('🔒 Se desbloquea al subir de nivel'); return; }
    S.atkSel = el.dataset.aid; renderPanel();
  });
  const lv = levelOf(mine), prevL = S.lastLevel[mine.id];
  if (prevL && lv > prevL){
    const nuevos = attackOptions(mine).filter(o => o.lvl > prevL && o.lvl <= lv).map(o => o.name);
    toast('⬆ ¡' + mine.name + ' sube a nivel ' + lv + '!' + (nuevos.length ? ' Nuevo: ' + nuevos.join(', ') : ''));
  }
  S.lastLevel[mine.id] = lv;
  const prevHp = S.lastHp[mine.id];
  if (prevHp != null && (mine.hp || 0) < prevHp && (mine.hp || 0) <= 0 && mine.hpMax > 0) toast('💀 ¡Has caído inconsciente!', true);
  S.lastHp[mine.id] = mine.hp || 0;
  const ap = $('#actPass'); if (ap) ap.onclick = () => armConfirm(ap, async () => {
    try { await rpc('round_pass', { tid: mine.id }); toast('⏭ Has pasado el turno'); } catch(e){ toast(e.message, true); }
  });
  $$('.atk-go').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await rpc('round_attack', { tid: mine.id, target: b.dataset.tid, attack_id: S.atkSel || 'basic' });
      S.attackPick = false;
      toast((r.crit ? '💥 ¡CRÍTICO con ' + r.attack + '! ' + r.dmg + ' de daño a ' + r.target
        : r.hit ? '⚔ ' + r.attack + ': ¡impacto! (' + r.d20 + '+' + r.atk + ' vs CA ' + r.ac + ') ' + r.dmg + ' de daño a ' + r.target
        : '🛡 ' + r.attack + ': fallo (' + r.d20 + '+' + r.atk + ' vs CA ' + r.ac + ')') + ' · +' + r.xp + ' XP');
      if (r.dead) setTimeout(() => toast('💀 ¡' + r.target + ' ha muerto! Su experiencia se reparte entre el grupo.'), 600);
      if (r.counter) setTimeout(() => toast(reactionText(r.counter), !!r.counter.hit), 1200);
    } catch(e){ toast(e.message, true); b.disabled = false; }
  });
  $$('.slot.full').forEach(el => el.onclick = () => { S.invSel = (S.invSel === el.dataset.iid) ? null : el.dataset.iid; renderPanel(); });
  const ie = $('#invEquip'); if (ie) ie.onclick = async () => {
    ie.disabled = true;
    try {
      const r = await rpc('item_equip', { tid: mine.id, iid: S.invSel, on_: !sel.equipped });
      toast((sel.equipped ? '🎒 Te quitas ' : '🛡 Te equipas ') + sel.name + ' · CA ' + r.ac + (r.warn ? ' · ⚠ ' + r.warn : ''));
    } catch(e){ toast(e.message, true); ie.disabled = false; }
  };
  const iu = $('#invUse'); if (iu) iu.onclick = async () => {
    const cat = sel.itemId ? S.itemById[sel.itemId] : findItem(sel.name);
    const fx = (cat && cat.fx) || sel.fx || { t: 'note' };
    if (fx.t === 'dmg'){ S.itemTarget = (S.itemTarget === sel.id) ? null : sel.id; renderPanel(); return; }
    iu.disabled = true;
    try {
      const r = await rpc('item_use', { tid: mine.id, iid: S.invSel, target: null });
      if (r.t === 'heal') toast('🧪 ' + r.name + ': +' + r.heal + ' PV (' + r.hp + '/' + r.hpMax + ')');
      else toast('🎒 Usas ' + r.name + (r.descr ? ' — ' + r.descr : ''));
      if ((r.qty || 0) <= 0) S.invSel = null;
    } catch(e){ toast(e.message, true); iu.disabled = false; }
  };
  $$('.item-go').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await rpc('item_use', { tid: mine.id, iid: S.invSel, target: b.dataset.tid });
      S.itemTarget = null;
      toast('💥 ' + r.name + ' contra ' + r.target + ': ' + (r.immune ? 'no le afecta' : r.mode === 'auto' ? r.dmg + ' de daño' : (r.saved ? 'supera la salvación' : 'falla la salvación') + ' → ' + r.dmg + ' de daño') + (r.burn ? ' · 🔥 ¡arde!' : '') + ' · +' + r.xp + ' XP');
      if (r.dead) setTimeout(() => toast('💀 ¡' + r.target + ' ha muerto!'), 600);
      if (r.counter) setTimeout(() => toast(reactionText(r.counter), !!r.counter.hit), 1200);
    } catch(e){ toast(e.message, true); b.disabled = false; }
  });
  const idr = $('#invDrop'); if (idr) idr.onclick = () => armConfirm(idr, async () => {
    try { await rpc('inv_drop', { tid: mine.id, iid: S.invSel }); S.invSel = null; toast('Has tirado ' + sel.name); } catch(e){ toast(e.message, true); }
  });
}
function roundCtlHtml(){
  const g = gameDoc() || {}, rd = g.round || {}, m = activeMap();
  const pcs = m ? gameTokens(m.id).filter(t => t.type === 'pc' && !t.hidden) : [];
  const done = rd.done || {}, pend = rd.pending || {};
  const nDone = pcs.filter(t => done[t.id]).length;
  const all = pcs.length > 0 && nDone >= pcs.length;
  let h = '<div class="section-title">🎲 Rondas libres (sin orden)</div><div class="card">';
  if (!rd.active){
    h += '<div class="mini">Cada jugador hace UNA acción por ronda desde su móvil, en el orden que quiera: moverse, atacar o pasar.</div>';
    if (S.isDM) h += '<button class="primary" id="rdStart" style="width:100%;margin-top:8px">▶ Abrir ronda 1</button>';
  } else {
    h += '<div class="row between"><b>Ronda ' + (rd.n || 1) + '</b><span class="round-pill ' + (all ? 'done' : 'wait') + '">' + nDone + '/' + pcs.length + ' han actuado</span></div>';
    pcs.forEach(t => {
      const a = done[t.id];
      h += '<div class="row between" style="margin-top:5px"><span>' + esc(t.name) + ' <span class="mini">(' + esc(t.ownerName || 'sin jugador') + ')</span></span>' +
        '<span class="mini">' + (a ? '✓ ' + ACTION_LABEL[a] : (pend[t.id] ? '🎲 moviendo (' + pend[t.id] + ')' : '…')) + '</span></div>';
    });
    if (S.isDM) h += '<div class="row" style="margin-top:8px"><button class="primary grow" id="rdNext">⏭ Pasar a ronda ' + ((rd.n || 1) + 1) + (all ? ' ✓' : '') + '</button><button class="danger small" id="rdStop">⏹ Cerrar</button></div>' +
      (all ? '' : '<div class="mini" style="margin-top:4px">Aún falta gente: si pasas de ronda, pierden su acción (pide confirmación).</div>');
  }
  return h + '</div>';
}
function bindRoundCtl(){
  if (!S.isDM) return;
  const st = $('#rdStart'); if (st) st.onclick = () => saveGame({ round: { active: true, n: 1, done: {}, pending: {} } });
  const nx = $('#rdNext'); if (nx) nx.onclick = () => {
    const rd = (gameDoc() || {}).round || {}, m = activeMap();
    const pcs = m ? gameTokens(m.id).filter(t => t.type === 'pc' && !t.hidden) : [];
    const go = async () => {
      try {
        const burned = S.localMode ? [] : await rpc('dm_round_tick', { gid: S.gameId });
        (burned || []).forEach((b, i) => setTimeout(() => toast('🔥 ' + b.name + ' arde: ' + b.dmg + ' de fuego' + (b.hp <= 0 ? ' 💀' : '')), 400 * (i + 1)));
      } catch(e){ toast('Ardiendo: ' + e.message, true); }
      const g2 = gameDoc() || {}, rd2 = g2.round || rd;
      saveGame({ round: { active: true, n: (rd2.n || 1) + 1, done: {}, pending: {} } }); toast('🎲 Ronda ' + ((rd2.n || 1) + 1));
    };
    if (pcs.every(t => (rd.done || {})[t.id])) go(); else armConfirm(nx, go);
  };
  const sp = $('#rdStop'); if (sp) sp.onclick = () => armConfirm(sp, () => saveGame({ round: { active: false, n: 0, done: {}, pending: {} } }));
}
let qrFor = null;
function updateQR(){
  const g = gameDoc(), box = $('#qrBox');
  const show = !!(g && S.gameId && g.showQR && (S.projector || (S.isDM && !S.phone)));
  box.style.display = show ? 'block' : 'none';
  const bq = $('#btnQR'); if (bq) bq.classList.toggle('on', !!(g && g.showQR));
  if (!show) return;
  if (g.private && !S.gameCode && !S.projector){ box.style.display = 'none'; return; }
  if (qrFor !== S.gameId){
    try {
      const url = location.origin + location.pathname + '?unirse=' + encodeURIComponent(S.gameId) + (S.gameCode ? '&c=' + encodeURIComponent(S.gameCode) : '');
      const q = qrcode(0, 'M'); q.addData(url); q.make();
      $('#qrImg').src = q.createDataURL(6, 2);
      box.title = url; qrFor = S.gameId;
    } catch(e){ box.style.display = 'none'; return; }
  }
  $('#qrCode').textContent = g.name || '';
}
$('#btnQR').onclick = () => { const g = gameDoc(); if (g) saveGame({ showQR: !g.showQR }); };
function askName(cb){
  $('#nameModal').classList.add('open');
  const inp = $('#nameInput'); inp.value = (lsGet('vtt_name') || ''); setTimeout(() => inp.focus(), 50);
  const ok = () => {
    const v = inp.value.trim(); if (!v){ inp.focus(); return; }
    lsSet('vtt_name', v); $('#myName').value = v;
    $('#nameModal').classList.remove('open'); cb();
  };
  $('#nameOk').onclick = ok;
  inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
}
/* Editor de inventario (DM) y campos por tipo de token */
(function initCtypes(){
  $('#tkCtype').innerHTML = '<option value="">— Sin tipo —</option>' + CTYPES.map(c => '<option value="' + c.toLowerCase() + '">' + c + '</option>').join('');
})();
(function initTokenSelects(){
  $('#tkCls').innerHTML = '<option value="">— Sin clase —</option>' + Object.entries(CLASSES).map(([k, c]) => '<option value="' + k + '">' + c.n + '</option>').join('');
  $('#tkRace').innerHTML = '<option value="">— Sin raza —</option>' + RACES.map(r => '<option>' + r + '</option>').join('');
})();
function toggleTkFields(){
  const pc = $('#tkType').value === 'pc';
  $$('.tkPcOnly').forEach(el => el.style.display = pc ? '' : 'none');
  $$('.tkMonOnly').forEach(el => el.style.display = $('#tkType').value === 'monster' ? '' : 'none');
  $('#tkAcLbl').textContent = pc ? 'Ajuste CA (±)' : 'CA';
  $('#tkXpLbl').textContent = pc ? 'XP acumulada' : 'XP al morir';
  updateXpHint();
}
function updateXpHint(){
  const pc = $('#tkType').value === 'pc';
  const v = $('#tkXp').value;
  if (pc){ const xp = parseInt(v) || 0, l = levelFor(xp); $('#tkXpHint').textContent = 'Nivel ' + l + (l < 10 ? ' · siguiente a ' + XP_LEVELS[l] + ' XP' : ' (máximo)'); }
  else $('#tkXpHint').textContent = v === '' ? 'Vacío = automático (5 × PV máx, mín. 20). Se reparte entre el grupo.' : 'Se reparte entre el grupo al morir.';
}
$('#tkXp').addEventListener('input', updateXpHint);
$('#tkType').addEventListener('change', toggleTkFields);
$('#tkCls').addEventListener('change', () => {
  const c = CLASSES[$('#tkCls').value]; if (!c) return;
  if ($('#tkType').value !== 'pc') $('#tkAc').value = c.ac;
  $('#tkAtk').value = c.atk; $('#tkDmg').value = c.dmg; $('#tkRange').value = c.range; $('#tkMove').value = c.move;
  const ab = CLASS_ABIL[$('#tkCls').value]; if (ab) ABILS.forEach(([k]) => { $('#ab_' + k).value = ab[k]; });
});
function renderInvEditor(){
  const box = $('#tkInvList'); if (!box || !S.tkInv) return;
  const items = S.tkInv.items || (S.tkInv.items = []);
  box.innerHTML = items.length ? items.map((it, i) =>
    '<div class="inv-edit-row"><input class="n" data-i="' + i + '" value="' + esc(it.name) + '"><input class="qn" type="number" min="1" data-i="' + i + '" value="' + (it.qty || 1) + '">' +
    '<label class="row" style="gap:3px"><input type="checkbox" class="cn" data-i="' + i + '" style="width:auto"' + (it.consumable ? ' checked' : '') + '>🧪</label>' +
    (it.itemId && S.itemById[it.itemId] && S.itemById[it.itemId].eq ? '<label class="row" style="gap:3px" title="Equipado"><input type="checkbox" class="eqc" data-i="' + i + '" style="width:auto"' + (it.equipped ? ' checked' : '') + '>✓</label>' : '') +
    '<button class="small inv-rm" data-i="' + i + '">✕</button></div>').join('')
    : '<div class="mini">Inventario vacío.</div>';
  box.querySelectorAll('input.n').forEach(el => el.oninput = () => { items[el.dataset.i].name = el.value; });
  box.querySelectorAll('input.qn').forEach(el => el.oninput = () => { items[el.dataset.i].qty = Math.max(1, parseInt(el.value) || 1); });
  box.querySelectorAll('input.cn').forEach(el => el.onchange = () => { items[el.dataset.i].consumable = el.checked; });
  box.querySelectorAll('.inv-rm').forEach(el => el.onclick = () => { items.splice(el.dataset.i, 1); renderInvEditor(); });
  box.querySelectorAll('input.eqc').forEach(el => el.onchange = () => {
    const it = items[el.dataset.i]; it.equipped = el.checked;
    const slot = ((S.itemById[it.itemId] || {}).eq || {}).slot;
    if (el.checked && ['armor', 'shield', 'weapon'].includes(slot))
      items.forEach(o => { if (o !== it && ((S.itemById[o.itemId] || {}).eq || {}).slot === slot) o.equipped = false; });
    renderInvEditor();
  });
}
$('#tkInvAdd').onclick = () => {
  const name = $('#tkInvName').value.trim(); if (!name) return;
  const slots = Math.max(1, parseInt($('#tkSlots').value) || 5);
  if ((S.tkInv.items || []).length >= slots){ toast('Inventario lleno: amplía las casillas', true); return; }
  const cat = findItem(name);
  S.tkInv.items.push(cat
    ? { id: uuid(), itemId: cat.id, name: cat.name, qty: Math.max(1, parseInt($('#tkInvQty').value) || cat.qty || 1), consumable: !!cat.consumable }
    : { id: uuid(), name, qty: Math.max(1, parseInt($('#tkInvQty').value) || 1), consumable: $('#tkInvCons').checked });
  $('#tkInvName').value = ''; $('#tkInvQty').value = 1; $('#tkInvCons').checked = false;
  renderInvEditor();
};
$('#tkInvName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#tkInvAdd').click(); });
$('#tkInvName').addEventListener('input', () => {
  const cat = findItem($('#tkInvName').value);
  if (cat){ $('#tkInvQty').value = cat.qty || 1; $('#tkInvCons').checked = !!cat.consumable; }
});
function normName(x){ return (x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' '); }
function findItem(name){
  const n = normName(name); if (!n) return null;
  return S.items.find(i => normName(i.name) === n || normName(i.en) === n) || null;
}
function giveItem(t, cat, name, qty, cons){
  const inv = JSON.parse(JSON.stringify(t.inventory || { slots: 5, items: [] }));
  inv.items = inv.items || [];
  if (inv.items.length >= (inv.slots || 5)) return false;
  inv.items.push(cat ? { id: uuid(), itemId: cat.id, name: cat.name, qty: Math.max(1, qty || cat.qty || 1), consumable: !!cat.consumable }
                     : { id: uuid(), name, qty: Math.max(1, qty || 1), consumable: !!cons });
  DB.doc('tokens/' + t.id).update({ inventory: inv }).catch(e => toast(e.message || e, true));
  return true;
}

/* ============ ayuda y tutorial ============ */
const HELP_KEYS_DM = [
  ['＋ －', 'Zoom', 'Acerca o aleja el mapa. También con la rueda del ratón o pellizcando en el móvil.'],
  ['⛶', 'Ajustar mapa', 'Encaja el mapa entero en la pantalla.'],
  ['▦', 'Rejilla', 'Muestra u oculta la cuadrícula de casillas.'],
  ['🧱', 'Muros', 'Muestra los muros importados y permite calibrar su posición sobre la imagen.'],
  ['🌫', 'Niebla de guerra', 'Activa o desactiva la niebla: los jugadores solo ven lo que ve su personaje.'],
  ['🚩', 'Punto de aparición', 'Pulsa y toca el mapa: ahí aparecerá el grupo al llegar a este mapa. Al activar otro mapa, el grupo viaja solo a su 🚩.'],
  ['📱', 'QR de acceso', 'Muestra en el mapa un QR para que los jugadores entren desde el móvil.'],
  ['📏', 'Regla', 'Toca o arrastra sobre el mapa para medir; cada toque añade un punto. Los jugadores ven tu medida.'],
  ['📐', 'Plantillas de área', 'Círculo, cono, línea o cubo: arrastra desde el origen y se marcan las casillas afectadas. Toca una para borrarla.'],
  ['💡', 'Luces', 'Con 🧱 activado ves las luces importadas de Dungeon Alchemist; tócalas para encenderlas o apagarlas. La oscuridad se ajusta en 🗺 Mapas.'],
  ['🎵', 'Sonido', 'Sube música y ambientes y dales a ▶: suenan sincronizados en todos los dispositivos.'],
  ['☰', 'Panel lateral', 'Oculta o muestra el panel para ver el mapa más grande.'],
  ['👁', 'Ver como jugador', 'Previsualiza exactamente lo que ven los jugadores (niebla incluida).'],
  ['📽', 'Proyector', 'Abre una segunda ventana con la vista de jugador para la tele o el proyector.'],
  ['🔗', 'Vista sincronizada', 'El proyector sigue tu encuadre y zoom. Desactívalo para moverlo por separado.'],
  ['⏻', 'Salir', 'Vuelve al lobby de partidas. La partida queda guardada.'],
  ['?', 'Ayuda', 'Abre esta ayuda o el tutorial guiado.']
];
const HELP_KEYS_PL = [
  ['🧙', 'Mi PJ', 'Tu ficha: PV, CA, características, equipo, acciones de ronda e inventario.'],
  ['🎲', 'Dados', 'Tira dados y escribe mensajes al grupo.'],
  ['⚔', 'Rondas', 'Rondas libres y orden de iniciativa cuando el DM inicia un combate.'],
  ['🎲 Mover', 'Moverte', 'Tira tu dado de movimiento y toca una casilla iluminada del mapa.'],
  ['⚔ Atacar', 'Atacar', 'Elige un ataque (los bloqueados se abren al subir de nivel) y luego el enemigo.'],
  ['⏭ Pasar', 'Pasar', 'Termina tu ronda sin hacer nada.'],
  ['🛡', 'Equipar', 'Toca una armadura, escudo, arma o accesorio del inventario y pulsa «Equipar».'],
  ['🧪', 'Usar', 'Toca un consumible (poción, ácido…) y pulsa «Beber» o «Usar contra…».'],
  ['⤢', 'Tamaño del mapa', 'En el móvil, alterna entre mapa grande, normal o pequeño.'],
  ['＋ ⛶', 'Zoom y ajustar', 'Acerca, aleja o encaja el mapa. También pellizcando.'],
  ['📏', 'Regla', 'Toca o arrastra sobre el mapa para medir distancias, con varios puntos. El resto del grupo ve tu medida.'],
  ['📐', 'Plantillas de área', 'Para conjuros como Bola de fuego: elige forma y arrastra desde el origen. Toca la tuya para borrarla.'],
  ['🔊', 'Sonido', 'La música que pone el DM. Si sale «Activar sonido», tócalo; en 🎵 Sonido ajustas tu volumen.']
];
function helpKeys(list){ return list.map(([k, t, d]) => '<div class="help-key"><div class="k">' + esc(k) + '</div><div><b>' + esc(t) + '</b><span>' + esc(d) + '</span></div></div>').join(''); }
function helpSections(){
  const dm = S.isDM, inGame = !!S.gameId;
  const secs = [];
  if (!inGame) secs.push(['start', '🚪 Empezar',
    '<h3>Entrar en una partida</h3><ol><li>Escribe tu nombre (lo verá el grupo).</li><li><b>Si eres el DM:</b> pon nombre a la partida y pulsa <b>Crear</b>. Si es privada, se genera un código que debes pasar a tus jugadores.</li><li><b>Si eres jugador:</b> pulsa <b>Entrar</b> en la partida de tu DM (o escanea el QR que te enseñe). Si es privada te pedirá el código.</li></ol>' +
    '<div class="help-tip">💡 Desde el móvil lo más cómodo es escanear el QR que el DM muestra en el mapa: entras directamente en su partida.</div>']);
  if (inGame && dm) secs.push(['start', '👑 Primeros pasos',
    '<h3>Preparar la sesión</h3><ol><li><b>🗺 Mapas:</b> importa el export de Dungeon Alchemist (JSON de Foundry + imagen/vídeo, o .dd2vtt) y pulsa <b>Activar</b>.</li><li><b>♟ Tokens:</b> crea los personajes (tipo <b>PJ</b>, con clase y raza) y los monstruos (ocultos hasta que quieras revelarlos).</li><li>Pulsa <b>📱</b> para mostrar el QR; cada jugador escanea, entra y elige su personaje.</li><li>Usa <b>📽 Proyector</b> si quieres mostrar la vista de jugador en una tele.</li></ol>' +
    '<h3>Varios mapas y personajes permanentes</h3><ul><li>Importa todos los mapas que quieras en <b>🗺 Mapas</b>; toca uno para activarlo (es el que ven los jugadores).</li><li>Los PJ viven en la partida, no en un mapa: en <b>♟ Tokens → Personajes de la partida</b> ves dónde está cada uno y lo mueves con <b>Mover a…</b>, <b>📍 Aquí</b> o <b>Traer a todo el grupo</b>. Conservan vida, ataque, inventario y experiencia.</li><li>Si borras un mapa, sus PJ pasan al <b>banquillo</b>; los monstruos de ese mapa se borran.</li><li>Pon un <b>🚩 punto de aparición</b> en cada mapa: al activar un mapa, el grupo llega solo a ese punto (se puede desactivar en 🗺 Mapas).</li><li>Monstruos y PNJ se quedan guardados en su mapa y en su posición, aunque cierres sesión o cambies de mapa.</li></ul>' +
    '<h3>Durante la partida</h3><ul><li>Arrastra los tokens para moverlos (solo el DM puede).</li><li>Doble clic / doble toque en un token para editarlo (PV, inventario, características…).</li><li>Abre las puertas desde el mapa con los muros visibles (🧱).</li></ul>']);
  if (inGame && !dm) secs.push(['start', '🛡 Primeros pasos',
    '<h3>Tu personaje</h3><ol><li>En <b>🧙 Mi PJ</b> pulsa <b>Este es mi personaje</b> en el que te haya preparado el DM.</li><li>En el mapa solo verás lo que ve tu PJ: la niebla tapa lo demás.</li><li>Tu ficha muestra PV, CA, nivel, características, equipo e inventario.</li></ol>' +
    '<div class="help-tip">💡 Quien mueve los tokens es el DM. Tú solo te mueves en tu acción de ronda.</div>']);
  if (inGame) secs.push(['round', '⚔ Rondas',
    '<h3>Rondas libres</h3><ol><li>El DM abre la ronda (pestaña ⚔ Rondas).</li><li>Cada jugador, sin orden, elige <b>una</b> acción: <b>🎲 Mover</b> (tira el dado y toca una casilla iluminada), <b>⚔ Atacar</b> (elige ataque y enemigo a tu alcance y a la vista) o <b>⏭ Pasar</b>.</li><li>Cuando todos han actuado, el DM pulsa <b>Siguiente ronda</b>.</li></ol>' +
    '<h3>Combate</h3><ul><li>El ataque tira d20 + tu bonificador contra la CA del enemigo. Un 20 es crítico (doble daño).</li><li>Los monstruos responden: contraatacan si les golpeas a su alcance y atacan si entras en su zona con línea de visión.</li><li>A 0 PV los monstruos desaparecen y su experiencia se reparte; un PJ a 0 PV queda inconsciente y no puede actuar.</li><li>Los ataques nuevos de tu clase se desbloquean al subir de nivel.</li></ul>' +
    (dm ? '<h3>Iniciativa clásica</h3><p>Si prefieres turnos ordenados: <b>＋ Tokens del mapa</b>, <b>🎲 Tirar iniciativas</b> e <b>Iniciar combate</b>.</p>' : '')]);
  if (inGame) secs.push(['items', '🎒 Objetos y equipo',
    '<h3>Inventario</h3><ul><li>5 casillas de inicio; el DM puede ampliarlas.</li><li>Toca un objeto para ver qué hace.</li><li><b>Consumibles</b> (pociones, ácido, varitas…): su efecto se aplica solo según las reglas. Las pociones de curación son acción adicional; lanzar ácido gasta tu acción de ronda.</li><li><b>Equipables</b> (armaduras, escudos, armas, anillos…): pulsa <b>Equipar</b>. Queda guardado y tu CA y tu arma se recalculan.</li><li>Los objetos <b>narrativos</b> se registran y el DM aplica el efecto.</li></ul>' +
    (dm ? '<h3>Dar objetos</h3><p>En ♟ Tokens usa el desplegable con todos los objetos de D&D 2024 para dárselos a un PJ o a todo el grupo. En el editor del token puedes marcar ✓ lo que lleva puesto.</p>' : '') +
    '<div class="help-tip">💡 Si escribes un objeto a mano y su nombre coincide con el catálogo (aunque falten tildes), se enlaza solo y funciona igual.</div>']);
  secs.push(['keys', '🔘 Botones', '<h3>Para qué sirve cada botón</h3>' + helpKeys(dm ? HELP_KEYS_DM : HELP_KEYS_PL)]);
  secs.push(['faq', '💬 Preguntas',
    '<h3>Preguntas frecuentes</h3><ul>' +
    '<li><b>No veo nada del mapa.</b> La niebla solo muestra lo que ve tu PJ. Comprueba que has elegido personaje en 🧙 Mi PJ.</li>' +
    '<li><b>No puedo moverme.</b> Solo puedes moverte en tu acción de ronda cuando el DM la abre, y una vez por ronda.</li>' +
    '<li><b>La poción no cura.</b> Debe ser una poción de curación del catálogo. El «Elixir de salud» cura estados, no PV.</li>' +
    '<li><b>Mi CA ha cambiado.</b> La CA se calcula con el equipo puesto. Equipa tu armadura y escudo.</li>' +
    '<li><b>¿Necesito cuenta?</b> No: puedes jugar como invitado. Con cuenta (correo o Google) entras desde cualquier dispositivo y no pierdes tus partidas ni personajes. Lo que hiciste como invitado pasa a tu cuenta al crearla.</li>' +
    '<li><b>¿Quién ve mi correo?</b> Nadie más: los demás solo ven el nombre que elijas.</li>' +
    '<li><b>Partidas privadas.</b> No salen en la lista: se entra con el código del DM o escaneando su QR.</li>' +
    '<li><b>Se ve pequeño en el móvil.</b> Usa <b>⤢</b> para agrandar el mapa y pellizca para hacer zoom.</li>' +
    (dm ? '<li><b>Los jugadores no ven un token.</b> Los monstruos ocultos no se ven; los PJ deben ser de tipo PJ.</li>' : '') +
    '</ul>']);
  return secs;
}
let helpSec = null;
function openHelp(sec){
  const secs = helpSections();
  const want = sec || ({ init: 'round', pj: 'start', tokens: S.isDM ? 'items' : 'start', maps: 'start', dice: 'keys' })[S.tab] || 'start';
  helpSec = secs.find(x => x[0] === want) ? want : secs[0][0];
  const draw = () => {
    $('#helpTabs').innerHTML = secs.map(x => '<button data-s="' + x[0] + '"' + (x[0] === helpSec ? ' class="active"' : '') + '>' + x[1] + '</button>').join('');
    $('#helpBody').innerHTML = secs.find(x => x[0] === helpSec)[2];
    $$('#helpTabs button').forEach(b => b.onclick = () => { helpSec = b.dataset.s; draw(); });
  };
  draw();
  $('#helpTour').style.display = S.gameId ? '' : 'none';
  if ($('#tourAsk').classList.contains('open')){ $('#tourAsk').classList.remove('open'); lsSet('vtt_tour_' + (S.isDM ? 'dm' : 'pl'), 1); }
  $('#helpModal').classList.add('open');
}
$('#btnHelp').onclick = () => openHelp();
$('#lobbyHelp').onclick = () => openHelp('start');
$('#helpClose').onclick = () => $('#helpModal').classList.remove('open');
$('#helpModal').addEventListener('click', e => { if (e.target.id === 'helpModal') $('#helpModal').classList.remove('open'); });
$('#helpTour').onclick = () => { $('#helpModal').classList.remove('open'); startTour(); };

function tourSteps(){
  const tab = n => () => selectTab(n);
  const common0 = [{ sel: '#btnHelp', t: 'Ayuda siempre a mano', d: 'Este botón abre la ayuda: para qué sirve cada botón, cómo funcionan las rondas y los objetos, y este tutorial.' }];
  if (S.isDM) return common0.concat([
    { sel: '#tabs', t: 'Pestañas del DM', d: 'Aquí organizas la partida: Mapas, Tokens, Rondas (e iniciativa), Dados y Sonido.' },
    { sel: '#tabMapsBtn', t: '1 · Importa un mapa', d: 'Sube el export de Dungeon Alchemist (JSON de Foundry + imagen, o .dd2vtt). Luego pulsa «Activar» para que todos lo vean.', pre: tab('maps') },
    { sel: '#tabs button[data-tab="tokens"]', t: '2 · Crea los tokens', d: 'Crea los PJ (tipo PJ, con clase y raza) y los monstruos. Los monstruos ocultos no los ven los jugadores. También aquí das objetos al grupo.', pre: tab('tokens') },
    { sel: '#tabs button[data-tab="init"]', t: '3 · Rondas y combate', d: 'Abre una ronda: cada jugador hace una acción (mover, atacar o pasar) desde su móvil. Cuando acaben todos, pasa a la siguiente.', pre: tab('init') },
    { sel: '#stage', t: 'El mapa', d: 'Arrastra el fondo para desplazarte, rueda o pellizco para el zoom. Arrastra un token para moverlo; doble clic para editarlo.' },
    { sel: '#stageTools', t: 'Herramientas del mapa', d: 'Zoom, ajustar, rejilla, regla (📏), plantillas de área (📐), muros y luces (🧱) y niebla de guerra (🌫).' },
    { sel: '#tabAudioBtn', t: 'Música y ambiente', d: 'Sube pistas y dales a ▶: suenan a la vez en los dispositivos de todos.', pre: tab('audio') },
    { sel: '#btnQR', t: 'QR para los jugadores', d: 'Muestra un QR en el mapa. Los jugadores lo escanean con el móvil y entran directamente a elegir su personaje.' },
    { sel: '#btnViewAs', t: 'Ver como jugador', d: 'Comprueba lo que ven los jugadores, niebla incluida.' },
    { sel: '#btnProjector', t: 'Proyector', d: 'Abre una segunda ventana con la vista de jugador para la tele o el proyector.' },
    { sel: '#sidebarToggle', t: 'Más espacio', d: 'Oculta el panel lateral para ver el mapa más grande.' },
    { sel: '#btnMapSize', t: 'Tamaño del mapa', d: 'En pantallas pequeñas, alterna entre mapa grande, normal o pequeño.' },
    { sel: '#btnHideMap', t: 'Ocultar el mapa', d: 'En el móvil, quita el mapa para tener todo el panel a pantalla completa.' }
  ]);
  return common0.concat([
    { sel: '#tabPjBtn', t: 'Tu personaje', d: 'Aquí está tu ficha. Si aún no tienes, pulsa «Este es mi personaje» en el que te haya preparado el DM.', pre: tab('pj') },
    { sel: '.sheet-head', t: 'Tu ficha', d: 'PV, CA, nivel y competencia. Debajo, tus características y la barra de experiencia.' },
    { sel: '.act-grid', t: 'Tu acción de ronda', d: 'Cuando el DM abre la ronda eliges UNA acción: 🎲 Mover (tira y toca una casilla iluminada), ⚔ Atacar o ⏭ Pasar.' },
    { sel: '.inv-grid', t: 'Inventario', d: 'Toca un objeto para verlo. Las pociones se beben con «Beber»; armaduras y armas se ponen con «Equipar» y quedan guardadas.' },
    { sel: '#stage', t: 'El mapa', d: 'Solo ves lo que ve tu personaje. Pellizca para hacer zoom y arrastra para moverte por el mapa.' },
    { sel: '#btnMapSize', t: 'Tamaño del mapa', d: 'En el móvil, alterna entre mapa grande, normal o pequeño.' },
    { sel: '#btnHideMap', t: 'Ocultar el mapa', d: 'En el móvil, quita el mapa para ver la ficha y los botones a pantalla completa. Vuelve a pulsarlo para verlo; al moverte se muestra solo.' },
    { sel: '#tabs button[data-tab="dice"]', t: 'Dados y chat', d: 'Tira cualquier dado y escribe mensajes al grupo.' },
    { sel: '#btnRuler', t: 'Medir y áreas', d: '📏 mide distancias tocando el mapa y 📐 coloca áreas de conjuros (cono, círculo, línea, cubo).' }
  ]);
}
const tour = { steps: [], i: 0 };
function visibleEl(sel){
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') return null;
  return el;
}
function startTour(){
  tour.steps = tourSteps(); tour.i = 0;
  $('#tourAsk').classList.remove('open');
  lsSet('vtt_tour_' + (S.isDM ? 'dm' : 'pl'), 1);
  $('#tourLayer').classList.add('open');
  showTourStep(1);
}
function endTour(){ $('#tourLayer').classList.remove('open'); }
function showTourStep(dir){
  while (tour.i >= 0 && tour.i < tour.steps.length){
    const st = tour.steps[tour.i];
    if (st.pre) st.pre();
    const el = visibleEl(st.sel);
    if (el){ placeTour(el, st); return; }
    tour.i += dir;
  }
  endTour();
}
function placeTour(el, st){
  if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  const r = el.getBoundingClientRect(), pad = 6;
  const sp = $('#tourSpot');
  sp.style.left = (r.left - pad) + 'px'; sp.style.top = (r.top - pad) + 'px';
  sp.style.width = (r.width + pad * 2) + 'px'; sp.style.height = (r.height + pad * 2) + 'px';
  $('#tourTitle').textContent = st.t; $('#tourText').textContent = st.d;
  const n = tour.steps.length;
  $('#tourDots').textContent = 'Paso ' + (tour.i + 1) + ' de ' + n;
  $('#tourPrev').disabled = tour.i === 0;
  $('#tourNext').textContent = tour.i >= n - 1 ? '¡Listo! ✓' : 'Siguiente →';
  const card = $('#tourCard'), vw = window.innerWidth, vh = window.innerHeight;
  const cw = card.offsetWidth || 320, ch = card.offsetHeight || 170;
  let top = r.bottom + 12;
  if (top + ch > vh - 8) top = r.top - ch - 12;
  if (top < 8) top = Math.max(8, Math.min(vh - ch - 8, r.top + r.height / 2 - ch / 2));
  if (r.height > vh * 0.5) top = Math.max(8, vh / 2 - ch / 2);
  let left = r.left + r.width / 2 - cw / 2;
  left = Math.max(12, Math.min(vw - cw - 12, left));
  card.style.top = top + 'px'; card.style.left = left + 'px';
}
$('#tourNext').onclick = () => { if (tour.i >= tour.steps.length - 1) return endTour(); tour.i++; showTourStep(1); };
$('#tourPrev').onclick = () => { if (tour.i > 0){ tour.i--; showTourStep(-1); } };
$('#tourSkip').onclick = endTour;
$('#tourBlock').onclick = () => $('#tourNext').click();
window.addEventListener('resize', () => { if ($('#tourLayer').classList.contains('open')) showTourStep(1); });
document.addEventListener('keydown', e => {
  if ($('#tourLayer').classList.contains('open')){
    if (e.key === 'Escape') endTour(); else if (e.key === 'ArrowRight') $('#tourNext').click(); else if (e.key === 'ArrowLeft') $('#tourPrev').click();
  } else if (e.key === 'Escape'){ $('#helpModal').classList.remove('open'); if (S.pickSpawn) setSpawnMode(false); }
});
function maybeOfferTour(){
  if (S.projector || !S.gameId || lsGet('vtt_tour_' + (S.isDM ? 'dm' : 'pl'))) return;
  setTimeout(() => { if (S.gameId && !$('#tourLayer').classList.contains('open')) $('#tourAsk').classList.add('open'); }, 1200);
}
$('#tourAskYes').onclick = () => startTour();
$('#tourAskNo').onclick = () => { $('#tourAsk').classList.remove('open'); lsSet('vtt_tour_' + (S.isDM ? 'dm' : 'pl'), 1); toast('Cuando quieras, pulsa ? para ver la ayuda o el tutorial'); };

/* Modo móvil */
function updatePhoneMode(){
  const narrow = !!(window.matchMedia && (window.matchMedia('(max-width: 860px)').matches || window.matchMedia('(max-height: 520px) and (max-width: 1000px)').matches));
  const was = S.phone;
  S.phone = !S.projector && narrow;
  document.body.classList.toggle('phone', S.phone);
  if (was !== S.phone){ setTimeout(resizeCanvas, 50); if (S.gameId) updateQR(); }
}
updatePhoneMode();
window.addEventListener('resize', updatePhoneMode);

/* ============ proyector (segunda pantalla) ============ */
let projBC = null;
try { projBC = new BroadcastChannel('vtt-proyector'); } catch(e){}
let lastCamSent = '';
function sendCamToProjector(){
  if (S.projector || !projBC || !S.projectorOpen || !S.syncProjector || !S.gameId) return;
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  const c = screenToMap(r.width / 2, r.height / 2);
  const msg = { type: 'cam', gameId: S.gameId, cx: c.x, cy: c.y, visW: r.width / S.cam.s, visH: r.height / S.cam.s };
  const key = [msg.cx, msg.cy, msg.visW, msg.visH].map(v => Math.round(v)).join(',');
  if (key === lastCamSent) return;
  lastCamSent = key;
  projBC.postMessage(msg);
}
let lastCamMsg = null;
window.addEventListener('resize', () => { if (S.projector && lastCamMsg) setTimeout(() => applyCamFromDM(lastCamMsg), 60); });
function applyCamFromDM(msg){
  lastCamMsg = msg;
  const r = cv.getBoundingClientRect();
  if (!r.width || !msg.visW) return;
  const s = Math.min(r.width / msg.visW, r.height / msg.visH);
  S.cam.s = s;
  S.cam.x = r.width / 2 - msg.cx * s;
  S.cam.y = r.height / 2 - msg.cy * s;
  needsDraw();
}
if (projBC){
  projBC.onmessage = ev => {
    const msg = ev.data || {};
    if (S.projector){
      if (msg.type === 'cam' && msg.gameId === S.gameId) applyCamFromDM(msg);
      if (msg.type === 'fit') fitView();
    } else {
      if (msg.type === 'hello' && msg.gameId === S.gameId){
        if (!S.projectorOpen){ S.projectorOpen = true; applyRole(); }
        lastCamSent = ''; sendCamToProjector();
      }
      if (msg.type === 'bye' && S.projectorOpen){ S.projectorOpen = false; applyRole(); }
    }
  };
}
$('#btnProjector').onclick = () => {
  if (!S.gameId) return;
  const url = location.pathname + '?proyector=' + encodeURIComponent(S.gameId);
  const w = window.open(url, 'vtt-proyector', 'popup,width=1280,height=720');
  if (!w){ toast('El navegador ha bloqueado la ventana emergente: permítela para este sitio', true); return; }
  S.projectorOpen = true; applyRole();
  toast('Arrastra la ventana del proyector a la otra pantalla y pulsa «Pantalla completa»');
};
$('#btnSync').onclick = () => {
  S.syncProjector = !S.syncProjector;
  const b = $('#btnSync');
  b.classList.toggle('on', S.syncProjector);
  b.textContent = S.syncProjector ? '🔗 Vista sincronizada' : '⛓‍💥 Proyector congelado';
  if (S.syncProjector){ lastCamSent = ''; sendCamToProjector(); }
};
if (S.projector){
  document.body.classList.add('projector');
  document.title = '📽 Proyector — Mesa de Rol';
  const fsBtn = document.createElement('button');
  fsBtn.id = 'projFs'; fsBtn.textContent = '⛶ Pantalla completa';
  fsBtn.onclick = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).catch(() => toast('Usa F11 para pantalla completa'));
    else document.exitFullscreen();
  };
  document.body.appendChild(fsBtn);
  let idleT = null;
  const wake = () => { document.body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add('idle'), 2500); };
  window.addEventListener('mousemove', wake); wake();
  document.addEventListener('fullscreenchange', () => setTimeout(resizeCanvas, 50));
  if (projBC){
    const hello = () => projBC.postMessage({ type: 'hello', gameId: S.projector });
    hello(); setInterval(hello, 5000);
    window.addEventListener('beforeunload', () => projBC.postMessage({ type: 'bye' }));
  }
}

/* ============ pestañas / paneles ============ */
function selectTab(name){
  S.tab = name;
  $$('#tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
  renderPanel();
}
$$('#tabs button').forEach(b => b.onclick = () => selectTab(b.dataset.tab));
function renderPanel(){
  const p = $('#panel');
  if (!S.gameId){ p.innerHTML = '<div class="muted">Entra en una partida para empezar.</div>'; return; }
  if (S.tab === 'maps') renderMapsPanel(p);
  else if (S.tab === 'pj') renderPjPanel(p);
  else if (S.tab === 'tokens') renderTokensPanel(p);
  else if (S.tab === 'init') renderInitPanel(p);
  else if (S.tab === 'audio') renderAudioPanel(p);
  else renderDicePanel(p);
}

/* --- mapas --- */
function renderMapsPanel(p){
  if (!S.isDM){ p.innerHTML = '<div class="muted">Solo el DM gestiona los mapas.</div>'; return; }
  let html = '<button class="primary" id="btnImport" style="width:100%">📥 Importar mapa a esta partida</button>';
  const maps = gameMaps();
  html += '<div class="section-title">Mapas de esta partida (' + maps.length + ')</div>';
  if (!maps.length) html += '<div class="muted">Aún no hay mapas. Exporta desde Dungeon Alchemist en formato <b>Foundry</b> (JSON + imagen) o <b>Universal VTT</b> e impórtalos aquí. Puedes tener todos los que quieras.</div>';
  else html += '<div class="mini" style="margin-bottom:6px">Toca un mapa para activarlo: es el que ven los jugadores.</div>';
  maps.forEach(m => {
    const active = m.id === S.activeMapId;
    const toks = gameTokens(m.id), pcs = toks.filter(t => t.type === 'pc').length, mons = toks.filter(t => t.type === 'monster').length;
    html += '<div class="map-item' + (active ? ' active' : '') + '" data-id="' + esc(m.id) + '">' +
      '<div class="thumb" style="background-image:url(' + esc(safeUrl(m.assetUrl)) + ')"></div>' +
      '<div class="grow"><b>' + esc(m.name) + '</b><div class="mini">' + (active ? '<b style="color:var(--accent)">ACTIVO</b> · ' : '') + pcs + ' PJ · ' + mons + ' monstruos · ' + ((m.walls || []).length) + ' muros</div></div>' +
      '<button class="small act-del" data-id="' + esc(m.id) + '" title="Eliminar mapa (los PJ pasan al banquillo)">🗑</button></div>';
  });
  const others = Object.values(S.maps).filter(m => m.ownerId === S.uid && (m.gameId || null) !== S.gameId);
  if (others.length){
    html += '<div class="section-title" style="cursor:pointer" id="othersToggle">' + (S.mapsOther ? '▾' : '▸') + ' Tus mapas de otras partidas (' + others.length + ')</div>';
    if (S.mapsOther) others.forEach(m => {
      html += '<div class="map-item" style="cursor:default"><div class="thumb" style="background-image:url(' + esc(safeUrl(m.assetUrl)) + ')"></div>' +
        '<div class="grow"><b>' + esc(m.name) + '</b><div class="mini">' + ((m.walls || []).length) + ' muros</div></div>' +
        '<button class="small map-copy" data-id="' + esc(m.id) + '" title="Añadir una copia a esta partida">➕ Añadir</button></div>';
    });
  }
  const m = activeMap();
  if (m){
    const gd = gameDoc() || {};
    html += '<div class="section-title">🚩 Llegada del grupo</div><div class="card">' +
      '<div class="row between"><label>Punto de aparición</label><span class="row">' + (m.spawn ? '<span class="mini" style="color:var(--accent)">✓ puesto</span><button class="small" id="clearSpawn">Quitar</button>' : '<span class="mini">sin poner</span>') + '<button class="small primary" id="setSpawn">' + (m.spawn ? 'Mover' : 'Colocar') + '</button></span></div>' +
      '<div class="row between" style="margin-top:6px"><label>Al cambiar de mapa, llevar al grupo automáticamente</label><button class="small" id="setAutoMove">' + (gd.autoMove === false ? 'No' : 'Sí') + '</button></div>' +
      '<div class="mini" style="margin-top:4px">Al activar otro mapa, los PJ que estaban en el mapa anterior o en el banquillo aparecen en su 🚩 (o en el centro si no tiene). Los demás PJ se quedan donde estén.</div></div>';
    html += '<div class="section-title">Ajustes del mapa activo</div><div class="card">' +
      '<div class="row between"><label>Niebla de guerra</label><button class="small" id="setFog">' + (m.fog === false ? 'Activar' : 'Desactivar') + '</button></div>' +
      '<div class="row between" style="margin-top:6px"><label>Rejilla (px/casilla)</label><input type="number" id="setGrid" value="' + (m.grid || 70) + '" min="8"></div>' +
      '<div class="row between" style="margin-top:6px"><label>Visión por defecto (casillas)</label><input type="number" id="setVision" value="' + (m.defaultVision == null ? 12 : m.defaultVision) + '" min="0"></div>';

    if (S.showWalls){
      html += '<div class="section-title">Calibrar muros (🧱 activado)</div>' +
        '<div class="mini" style="margin-bottom:6px">Si los muros no coinciden con el dibujo, muévelos:</div>' +
        '<div class="row"><button class="small cal" data-x="-5" data-y="0">←5</button><button class="small cal" data-x="5" data-y="0">→5</button><button class="small cal" data-x="0" data-y="-5">↑5</button><button class="small cal" data-x="0" data-y="5">↓5</button>' +
        '<button class="small cal" data-x="-' + (m.grid || 70) + '" data-y="0">←1 casilla</button><button class="small cal" data-x="' + (m.grid || 70) + '" data-y="0">→1 casilla</button></div>' +
        '<div class="row" style="margin-top:4px"><button class="small cal" data-x="0" data-y="-' + (m.grid || 70) + '">↑1 casilla</button><button class="small cal" data-x="0" data-y="' + (m.grid || 70) + '">↓1 casilla</button><button class="small" id="calReset">Reiniciar</button><span class="mini">off: ' + (m.wallOffX || 0) + ',' + (m.wallOffY || 0) + '</span></div>';
    }
    html += '<div class="row between" style="margin-top:6px"><label>Visión compartida (todos ven lo de todos los PJs)</label><button class="small" id="setShared">' + (m.sharedVision === true ? 'Sí' : 'No') + '</button></div>';
    html += '<div class="row between" style="margin-top:6px"><label>Recordar zonas exploradas (se guardan para cada jugador)</label><button class="small" id="setRemember">' + (m.rememberExplored !== false ? 'Sí' : 'No') + '</button></div>' +
      '<div class="row" style="margin-top:8px"><button class="small" id="resetExplored">🌫 Reiniciar zonas exploradas</button></div></div>';
    html += '<div class="section-title">💡 Luz y oscuridad</div><div class="card">' +
      '<div class="row between"><label>Oscuridad del mapa</label><span class="row"><input type="range" id="setDark" min="0" max="100" step="5" value="' + Math.round(mapDarkness(m) * 100) + '" style="width:120px"><b id="setDarkV" style="min-width:38px; text-align:right">' + Math.round(mapDarkness(m) * 100) + '%</b></span></div>' +
      '<div class="mini" style="margin-top:4px">Desde el ' + Math.round(DARK_SEE * 100) + '% los PJ solo ven lo iluminado o con visión en la oscuridad (elfos, enanos, gnomos, semielfos, semiorcos y tiflin: 12 casillas).</div>' +
      '<div class="row between" style="margin-top:8px"><label>Luces del mapa: ' + (m.lights || []).length + (Object.keys(m.lightsOff || {}).length ? ' (' + Object.keys(m.lightsOff || {}).length + ' apagadas)' : '') + ' · tamaño ×</label><input type="number" id="setLightScale" step="0.25" min="0.25" value="' + (m.lightScale > 0 ? m.lightScale : 1) + '" style="width:70px"></div>' +
      '<div class="mini" style="margin-top:4px">' + ((m.lights || []).length ? 'Con 🧱 activado verás las luces (💡): tócalas para encenderlas o apagarlas. Si el radio no cuadra con el dibujo, cambia el tamaño.' : 'Este mapa no trae luces. Reimpórtalo desde Dungeon Alchemist (export de Foundry o .dd2vtt) para traerlas, o da antorchas a los tokens.') + '</div></div>';
  }
  p.innerHTML = html;
  $('#btnImport').onclick = openImport;
  const ot = $('#othersToggle'); if (ot) ot.onclick = () => { S.mapsOther = !S.mapsOther; renderPanel(); };
  $$('.map-item[data-id]').forEach(el => el.onclick = e => {
    if (e.target.closest('button')) return;
    activateMap(el.dataset.id);
  });
  const am = $('#setAutoMove'); if (am) am.onclick = () => saveGame({ autoMove: (gameDoc() || {}).autoMove === false });
  const sp = $('#setSpawn'); if (sp) sp.onclick = () => setSpawnMode(true);
  const spc = $('#clearSpawn'); if (spc) spc.onclick = () => { const mm = activeMap(); if (mm) DB.doc('maps/' + mm.id).update({ spawn: null }).catch(() => {}); };
  $$('.map-copy').forEach(b => b.onclick = async () => {
    const src = S.maps[b.dataset.id]; if (!src) return;
    b.disabled = true;
    try {
      const mine = Object.values(S.tokens).filter(t => t.mapId === src.id && t.gameId === S.gameId);
      if (!src.gameId || mine.length){
        // Mapa antiguo sin partida (o con tokens de esta partida): se mueve aquí tal cual, con sus tokens
        await DB.doc('maps/' + src.id).update({ gameId: S.gameId });
        toast('Mapa «' + src.name + '» añadido a la partida' + (mine.length ? ' con sus ' + mine.length + ' tokens' : ''));
      } else {
        const nid = uuid();
        const copy = JSON.parse(JSON.stringify(src)); delete copy.id;
        copy.gameId = S.gameId; copy.ownerId = S.uid; copy.createdAt = Date.now();
        await DB.doc('maps/' + nid).set(copy);
        const npcs = Object.values(S.tokens).filter(t => t.mapId === src.id && t.type !== 'pc');
        for (const t of npcs){
          const nt = JSON.parse(JSON.stringify(t)); delete nt.id; delete nt.ownerId; delete nt.ownerName;
          nt.gameId = S.gameId; nt.mapId = nid; nt.createdAt = Date.now();
          await DB.doc('tokens/' + uuid()).set(nt);
        }
        toast('Mapa «' + src.name + '» copiado a la partida' + (npcs.length ? ' con ' + npcs.length + ' monstruos/PNJ en sus posiciones' : ''));
      }
    } catch(e){ toast(e.message, true); b.disabled = false; }
  });
  $$('.act-del').forEach(b => b.onclick = e => {
    e.stopPropagation();
    armConfirm(b, async () => {
      const id = b.dataset.id;
      const toks = Object.values(S.tokens).filter(t => t.mapId === id && t.gameId === S.gameId);
      for (const t of toks){
        if (t.type === 'pc') await DB.doc('tokens/' + t.id).update({ mapId: null }).catch(() => {});
        else await DB.doc('tokens/' + t.id).delete().catch(() => {});
      }
      for (const tp of S.templates.filter(tp => tp.mapId === id)) await DB.doc('templates/' + tp.id).delete().catch(() => {});
      if (S.activeMapId === id) saveGame({ activeMapId: null });
      DB.doc('maps/' + id).delete().catch(e => toast(e.message, true));
      const n = toks.filter(t => t.type === 'pc').length;
      if (n) toast(n + ' PJ pasan al banquillo: muévelos a otro mapa desde ♟ Tokens');
    });
  });
  if (m){
    $('#setFog').onclick = () => DB.doc('maps/' + m.id).update({ fog: m.fog === false }).catch(() => {});
    $('#setGrid').onchange = e => DB.doc('maps/' + m.id).update({ grid: parseInt(e.target.value) || 70 }).catch(() => {});
    $('#setVision').onchange = e => DB.doc('maps/' + m.id).update({ defaultVision: parseInt(e.target.value) || 0 }).catch(() => {});
    $$('.cal').forEach(b => b.onclick = () => {
      DB.doc('maps/' + m.id).update({ wallOffX: (m.wallOffX || 0) + parseInt(b.dataset.x), wallOffY: (m.wallOffY || 0) + parseInt(b.dataset.y) }).catch(() => {});
    });
    const cr = $('#calReset'); if (cr) cr.onclick = () => DB.doc('maps/' + m.id).update({ wallOffX: 0, wallOffY: 0 }).catch(() => {});
    $('#setShared').onclick = () => DB.doc('maps/' + m.id).update({ sharedVision: m.sharedVision !== true }).catch(() => {});
    $('#setRemember').onclick = () => DB.doc('maps/' + m.id).update({ rememberExplored: m.rememberExplored === false }).catch(() => {});
    $('#resetExplored').onclick = e => armConfirm(e.currentTarget, () => {
      DB.doc('maps/' + m.id).update({ exploredReset: (m.exploredReset || 0) + 1 })
        .then(() => toast('Zonas exploradas reiniciadas para todos'))
        .catch(err => toast(err.message, true));
    });
    $('#setDark').oninput = e => { $('#setDarkV').textContent = e.target.value + '%'; };
    $('#setDark').onchange = e => DB.doc('maps/' + m.id).update({ darkness: clamp((parseInt(e.target.value) || 0) / 100, 0, 1) }).catch(() => {});
    $('#setLightScale').onchange = e => DB.doc('maps/' + m.id).update({ lightScale: Math.max(0.25, parseFloat(e.target.value) || 1) }).catch(() => {});
  }
}

/* --- tokens --- */
function rosterHtml(m){
  const pcs = gamePCs();
  const maps = gameMaps();
  let html = '<div class="section-title">🧙 Personajes de la partida (' + pcs.length + ')</div>';
  if (!pcs.length) return html + '<div class="muted">Crea los PJ con «＋ Nuevo token» (tipo Personaje). Se quedan guardados en la partida con su vida, ataque, inventario y experiencia, y los puedes mover de un mapa a otro.</div>';
  const away = pcs.filter(t => !m || t.mapId !== m.id);
  if (m && away.length) html += '<button class="small" id="rosterAll" style="width:100%; margin-bottom:6px">📍 Traer a todo el grupo a «' + esc(m.name) + '» (' + away.length + ')</button>';
  pcs.forEach(t => {
    const here = m && t.mapId === m.id;
    const loc = !t.mapId || !S.maps[t.mapId] ? '<span class="pc-loc bench">Banquillo</span>' : here ? '<span class="pc-loc here">En este mapa</span>' : '<span class="pc-loc">🗺 ' + esc(S.maps[t.mapId].name) + '</span>';
    html += tokenCard(t, loc, '<div class="roster-move"><select class="pc-to" data-tid="' + esc(t.id) + '"><option value="">Mover a…</option>' +
      maps.filter(mm => mm.id !== t.mapId).map(mm => '<option value="' + esc(mm.id) + '">🗺 ' + esc(mm.name) + (mm.id === S.activeMapId ? ' (activo)' : '') + '</option>').join('') +
      (t.mapId ? '<option value="__bench">🪑 Banquillo</option>' : '') + '</select>' +
      (m && !here ? '<button class="small primary pc-here" data-tid="' + esc(t.id) + '">📍 Aquí</button>' : '') + '</div>');
  });
  return html;
}
function tokenCard(t, extra, after){
  const url = safeUrl(t.imgUrl);
  const dot = url
    ? '<span class="tok-dot" style="background-image:url(' + esc(url) + '); border-color:' + esc(t.color || '#555') + '"></span>'
    : '<span class="tok-dot" style="background:' + esc(t.color || '#555') + '">' + esc((t.name || '?').charAt(0).toUpperCase()) + '</span>';
  return '<div class="card" data-tid="' + esc(t.id) + '"><div class="row between">' +
    '<div class="row grow" style="cursor:pointer; min-width:0">' + dot +
    '<div class="grow" style="min-width:0"><b>' + esc(t.name) + '</b>' + (t.hidden ? ' <span class="mini">(oculto)</span>' : '') + (extra ? ' ' + extra : '') +
    '<div class="mini">' + (t.type === 'pc' ? esc(raceCls(t)) + ' · Nv ' + levelOf(t) + ' · ' : '') + 'PV ' + (t.hp || 0) + '/' + (t.hpMax || 0) + (S.isDM && t.ac ? ' · CA ' + t.ac : '') +
    (S.isDM && t.type === 'monster' ? ' · ⚔ +' + (t.atk == null ? 3 : t.atk) + ' ' + esc(t.dmg || '1d6+1') + ' a ' + (t.range || 1) + (t.ctype ? ' · ' + esc(t.ctype) : '') : '') +
    (t.burning ? ' · 🔥' : '') +
    (t.type === 'pc' ? (t.ownerId ? ' · 🎮 ' + esc(t.ownerId === S.uid ? 'tú' : (t.ownerName || 'Jugador')) : ' · <i>libre</i>') : '') + '</div></div></div>' +
    '<div class="row">' +
    (S.isDM ? '<button class="small t-hp" data-d="-1" data-tid="' + esc(t.id) + '">−</button><button class="small t-hp" data-d="1" data-tid="' + esc(t.id) + '">＋</button>' +
      '<button class="small t-hide" data-tid="' + esc(t.id) + '">' + (t.hidden ? '👁' : '🙈') + '</button><button class="small t-edit" data-tid="' + esc(t.id) + '">✎</button>' +
      (t.ownerId ? '<button class="small t-unassign" data-tid="' + esc(t.id) + '" title="Liberar personaje">⛓</button>' : '') : '') +
    '</div></div>' +
    (t.hpMax > 0 ? '<div class="hpbar"><i style="width:' + clamp((t.hp || 0) / t.hpMax * 100, 0, 100) + '%"></i></div>' : '') +
    (after || '') + '</div>';
}
function renderTokensPanel(p){
  const m = activeMap();
  let html = '';
  if (S.isDM) html += '<button class="primary" id="btnNewToken" style="width:100%">＋ Nuevo token</button>';
  if (S.isDM){
    const pcsAll = gamePCs();
    if (pcsAll.length){
      html += '<div class="card" style="margin-top:8px"><div class="section-title" style="margin-top:0">🎁 Repartir objeto</div>' +
        '<div class="row"><input id="giveName" class="grow" list="itemList" placeholder="Busca entre ' + (S.items.length || 'los') + ' objetos 5e…"><input type="number" id="giveQty" min="1" value="1" style="width:56px"></div>' +
        '<div class="row" style="margin-top:6px"><select id="giveTo" class="grow"><option value="*">Todo el grupo (' + pcsAll.length + ' PJs)</option>' +
        pcsAll.map(t => '<option value="' + t.id + '">' + esc(t.name) + (t.ownerName ? ' (' + esc(t.ownerName) + ')' : '') + '</option>').join('') +
        '</select><button class="primary small" id="giveBtn">Dar</button></div><div class="item-desc" id="giveDesc"></div></div>';
    }
    const avail = pcsAll.filter(t => !t.hidden);
    if (!avail.length) html += '<div class="card" style="margin-top:8px; border-color:var(--accent)"><div class="mini">⚠ Tus jugadores no tienen ningún personaje que elegir: crea tokens de tipo <b>Personaje (PJ)</b> y que no estén ocultos (🙈).</div></div>';
    html += rosterHtml(m);
  }
  if (!m){ p.innerHTML = html + '<div class="muted" style="margin-top:10px">' + (S.isDM ? 'Activa un mapa en 🗺 Mapas para colocar monstruos y ver a los PJ.' : 'El DM aún no ha activado ningún mapa.') + '</div>'; bindTokenPanel(); return; }
  const toks = gameTokens(m.id);
  const seeAll = S.isDM;
  if (!S.isDM){
    const mine = myPC();
    const free = gamePCs().filter(t => !t.hidden && !t.ownerId);
    html += '<div class="card" style="border-color:var(--accent)">';
    if (mine){
      html += '<div class="section-title" style="margin-top:0">Tu personaje</div><div class="row between"><b>' + esc(mine.name) + '</b><button class="small" id="btnRelease">Cambiar</button></div>' +
        '<div class="mini" style="margin-top:4px">Ves lo que ve tu personaje. El DM mueve los tokens.</div>';
    } else {
      html += '<div class="section-title" style="margin-top:0">Elige tu personaje</div>';
      if (!free.length) html += '<div class="muted">No hay personajes libres. Pide al DM que cree tu PJ (tipo «Personaje»).</div>';
      free.forEach(t => {
        html += '<div class="row between" style="margin-bottom:6px"><b>' + esc(t.name) + '</b><button class="small primary t-claim" data-tid="' + t.id + '">Este es mi personaje</button></div>';
      });
    }
    html += '</div>';
  }
  const groups = [['Personajes en este mapa', S.isDM ? [] : toks.filter(t => t.type === 'pc')], ['PNJ', toks.filter(t => t.type === 'npc')], ['Monstruos', toks.filter(t => t.type === 'monster')]];
  groups.forEach(([title, list]) => {
    if (!seeAll){
      list = list.filter(t => !t.hidden);
      if (title === 'Monstruos') list = list.filter(tokenVisibleToPlayers);
    }
    if (!list.length) return;
    html += '<div class="section-title">' + title + '</div>';
    list.forEach(t => { html += tokenCard(t); });
  });
  if (!toks.length) html += '<div class="muted" style="margin-top:10px">' + (S.isDM ? 'Crea tokens para PJs y monstruos.' : 'El DM aún no ha colocado tokens.') + '</div>';
  if (!S.isDM) html += '<div class="mini" style="margin-top:8px">💡 Los tokens los mueve el DM. Pulsa un token de la lista para centrar la vista en él; doble clic en el mapa para señalar algo.</div>';
  p.innerHTML = html;
  bindTokenPanel();
}
function bindTokenPanel(){
  const bn = $('#btnNewToken'); if (bn) bn.onclick = () => openTokenModal(null);
  $$('.pc-to').forEach(sel => sel.onchange = () => {
    const v = sel.value; if (!v) return;
    movePCsTo([sel.dataset.tid], v === '__bench' ? null : v).catch(e => toast(e.message, true));
  });
  $$('.pc-here').forEach(b => b.onclick = () => movePCsTo([b.dataset.tid], S.activeMapId).catch(e => toast(e.message, true)));
  const ra = $('#rosterAll'); if (ra) ra.onclick = () => {
    const m = activeMap(); if (!m) return;
    movePCsTo(gamePCs().filter(t => t.mapId !== m.id).map(t => t.id), m.id).catch(e => toast(e.message, true));
  };
  const gn = $('#giveName');
  if (gn){
    gn.oninput = () => {
      const cat = findItem(gn.value);
      $('#giveDesc').innerHTML = cat ? '<b>' + esc(cat.cat) + (cat.rarity ? ' · ' + esc(cat.rarity) : '') + '</b> ' + esc(cat.descr || '') + fxTag(cat) : '';
      if (cat) $('#giveQty').value = cat.qty || 1;
    };
    $('#giveBtn').onclick = () => {
      const name = gn.value.trim(); if (!name) return;
      const cat = findItem(name), qty = parseInt($('#giveQty').value) || 1, to = $('#giveTo').value;
      const m = activeMap(); if (!m) return;
      const targets = to === '*' ? gameTokens(m.id).filter(t => t.type === 'pc') : [S.tokens[to]].filter(Boolean);
      let ok = 0; const full = [];
      targets.forEach(t => { if (giveItem(t, cat, name, qty, false)) ok++; else full.push(t.name); });
      toast('🎁 ' + (cat ? cat.name : name) + (qty > 1 ? ' ×' + qty : '') + ' → ' + ok + ' PJ' + (ok === 1 ? '' : 's') + (full.length ? ' · inventario lleno: ' + full.join(', ') : ''), !!full.length);
      if (!cat) toast('Objeto personalizado: sin efecto automático');
      gn.value = ''; $('#giveDesc').innerHTML = '';
    };
  }
  $$('.t-claim').forEach(b => b.onclick = async () => {
    b.disabled = true;
    if (S.localMode){
      const t = S.tokens[b.dataset.tid];
      await DB.doc('tokens/' + t.id).update({ ownerId: S.uid, ownerName: myName() });
    } else {
      const { data, error } = await SB.rpc('claim_token', { tid: b.dataset.tid, pname: myName() });
      if (error || !data){ toast(error ? error.message : 'Ese personaje ya lo ha cogido otro jugador', true); b.disabled = false; return; }
    }
    S.fogDirty = true;
    toast('¡Ahora eres ' + ((S.tokens[b.dataset.tid] || {}).name || 'tu personaje') + '!');
    setTimeout(() => fitView(), 600);
    const t = S.tokens[b.dataset.tid];
    if (t){ const r = cv.getBoundingClientRect(); S.cam.x = r.width / 2 - t.x * S.cam.s; S.cam.y = r.height / 2 - t.y * S.cam.s; needsDraw(); }
  });
  const br = $('#btnRelease'); if (br) br.onclick = async () => {
    const m = activeMap(); const mine = m && myToken(m.id); if (!mine) return;
    if (S.localMode) await DB.doc('tokens/' + mine.id).update({ ownerId: null, ownerName: null });
    else { const { error } = await SB.rpc('release_token', { tid: mine.id }); if (error){ toast(error.message, true); return; } }
    S.fogDirty = true;
  };
  $$('.t-unassign').forEach(b => b.onclick = () => {
    const t = S.tokens[b.dataset.tid]; if (!t) return;
    const nt = Object.assign({}, t); delete nt.id; delete nt.ownerId; delete nt.ownerName;
    DB.doc('tokens/' + t.id).set(nt).catch(e => toast(e.message || e, true));
  });
  $$('.t-edit').forEach(b => b.onclick = () => openTokenModal(b.dataset.tid));
  $$('.t-hide').forEach(b => b.onclick = () => {
    const t = S.tokens[b.dataset.tid];
    DB.doc('tokens/' + t.id).update({ hidden: !t.hidden }).catch(() => {});
    S.fogDirty = true;
  });
  $$('.t-hp').forEach(b => b.onclick = () => {
    const t = S.tokens[b.dataset.tid];
    dmSetHp(t, (t.hp || 0) + parseInt(b.dataset.d));
  });
  $$('.card[data-tid]').forEach(el => {
    const rowEl = el.querySelector('.row.grow');
    if (rowEl) rowEl.onclick = () => {
      const t = S.tokens[el.dataset.tid]; if (!t) return;
      if (t.mapId !== S.activeMapId){ toast(t.mapId && S.maps[t.mapId] ? t.name + ' está en «' + S.maps[t.mapId].name + '»' : t.name + ' está en el banquillo'); return; }
      const r = cv.getBoundingClientRect();
      S.cam.x = r.width / 2 - t.x * S.cam.s;
      S.cam.y = r.height / 2 - t.y * S.cam.s;
      needsDraw();
    };
  });
}
function setTkImgPreview(url){
  const img = $('#tkImgPrev');
  if (url){ img.src = url; img.style.display = ''; $('#tkImgClear').style.display = ''; }
  else { img.removeAttribute('src'); img.style.display = 'none'; $('#tkImgClear').style.display = 'none'; }
}
function openTokenModal(id){
  S.editingToken = id;
  S.tkImgBlob = null; S.tkImgClear = false;
  const t = id ? S.tokens[id] : null;
  $('#tokenModalTitle').textContent = t ? 'Editar token' : 'Nuevo token';
  $('#tkName').value = t ? t.name : '';
  $('#tkType').value = t ? t.type : 'pc';
  $('#tkColor').value = t ? (t.color || '#8c2b2b') : COLORS[Math.floor(Math.random() * COLORS.length)];
  $('#tkSize').value = t ? (t.size || 1) : 1;
  $('#tkHp').value = t ? (t.hp || 0) : 10;
  $('#tkHpMax').value = t ? (t.hpMax || 0) : 10;
  $('#tkVision').value = t ? (t.vision == null ? 12 : t.vision) : 12;
  $('#tkDv').value = t && t.darkvision != null && t.darkvision !== '' ? t.darkvision : '';
  $('#tkLight').value = t && t.lightKind && LIGHT_PRESETS[t.lightKind] ? t.lightKind : '';
  $('#tkCls').value = t ? (t.cls || '') : '';
  $('#tkRace').value = t ? (t.race || '') : '';
  $('#tkAc').value = t ? (t.ac || 12) : 12;
  $('#tkAtk').value = t && t.atk != null ? t.atk : 3;
  $('#tkDmg').value = t ? (t.dmg || '1d6') : '1d6';
  $('#tkXp').value = t && t.xp != null ? t.xp : '';
  $('#tkCtype').value = t ? (t.ctype || '') : '';
  const ab = Object.assign({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, (t && t.abil) || CLASS_ABIL[(t && t.cls) || ''] || {});
  ABILS.forEach(([k]) => { $('#ab_' + k).value = ab[k]; });
  $('#tkAcInfo').textContent = t && t.type === 'pc' && t.acParts ? 'CA actual ' + t.ac + ' = ' + t.acParts : '';
  if (t && t.type === 'pc') $('#tkAc').value = t.acMisc || 0;
  $('#tkSaveB').value = t && t.save != null ? t.save : 1;
  $('#tkBurn').checked = !!(t && t.burning);
  $('#tkRange').value = t ? (t.range || 1) : 1;
  $('#tkMove').value = t ? (t.moveDie || '1d6') : '1d6';
  S.tkInv = JSON.parse(JSON.stringify((t && t.inventory) || { slots: 5, items: [] }));
  $('#tkSlots').value = S.tkInv.slots || 5;
  renderInvEditor(); toggleTkFields();
  $('#tkImg').value = '';
  setTkImgPreview(t ? (t.imgUrl || null) : null);
  $('#tkDelete').style.display = t ? '' : 'none';
  $('#tkDup').style.display = t ? '' : 'none';
  $('#tokenModal').classList.add('open');
}
$('#tkImg').onchange = async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  S.tkImgBlob = await shrinkImage(f);
  S.tkImgClear = false;
  setTkImgPreview(URL.createObjectURL(S.tkImgBlob));
};
$('#tkImgClear').onclick = () => { S.tkImgBlob = null; S.tkImgClear = true; $('#tkImg').value = ''; setTkImgPreview(null); };
$('#tkCancel').onclick = () => $('#tokenModal').classList.remove('open');
$('#tkSave').onclick = async () => {
  const m = activeMap(); if (!S.gameId) return;
  if (!m && !S.editingToken && $('#tkType').value !== 'pc'){ toast('Activa primero un mapa para colocar monstruos y PNJ', true); return; }
  const btn = $('#tkSave'); btn.disabled = true;
  try {
    const id = S.editingToken || uuid();
    const old = S.editingToken ? S.tokens[S.editingToken] : null;
    let imgUrl = old ? (old.imgUrl || null) : null;
    if (S.tkImgClear) imgUrl = null;
    if (S.tkImgBlob){
      if (S.localMode) imgUrl = URL.createObjectURL(S.tkImgBlob);
      else imgUrl = (await uploadAsset(S.tkImgBlob)).url;
    }
    const center = old ? { x: old.x, y: old.y } : m ? ($('#tkType').value === 'pc' && m.spawn ? freeSpot(m, m.spawn) : viewCenterSnap(m)) : { x: 0, y: 0 };
    const t = {
      gameId: S.gameId, mapId: old ? (old.mapId || null) : (m ? m.id : null), name: ($('#tkName').value.trim() || 'Token').slice(0, 40),
      type: $('#tkType').value, color: $('#tkColor').value,
      size: parseInt($('#tkSize').value) || 1,
      hp: parseInt($('#tkHp').value) || 0, hpMax: parseInt($('#tkHpMax').value) || 0,
      vision: parseInt($('#tkVision').value), hidden: old ? !!old.hidden : ($('#tkType').value === 'monster'),
      darkvision: $('#tkDv').value === '' ? null : Math.max(0, parseInt($('#tkDv').value) || 0),
      imgUrl,
      x: center.x, y: center.y, createdAt: old ? (old.createdAt || Date.now()) : Date.now()
    };
    if (t.type === 'pc'){
      t.acMisc = parseInt($('#tkAc').value) || 0;
      t.abil = {}; ABILS.forEach(([k]) => { t.abil[k] = Math.max(1, Math.min(30, parseInt($('#ab_' + k).value) || 10)); });
      t.ac = old && old.ac ? old.ac : 10;
      ['acParts', 'wpn', 'abilEff', 'pb', 'attuned', 'eqWarn'].forEach(k => { if (old && old[k] != null) t[k] = old[k]; });
    } else t.ac = Math.max(1, parseInt($('#tkAc').value) || 12);
    t.atk = parseInt($('#tkAtk').value) || 0;
    t.dmg = ($('#tkDmg').value || '').trim() || '1d6';
    t.range = Math.max(1, parseInt($('#tkRange').value) || 1);
    const xpv = $('#tkXp').value;
    if (t.type === 'pc'){ t.xp = Math.max(0, parseInt(xpv) || 0); t.level = Math.max(levelFor(t.xp), old && old.xp === t.xp ? (old.level || 1) : 1); }
    else if (xpv !== '') t.xp = Math.max(0, parseInt(xpv) || 0);
    if (t.type === 'monster'){
      t.ctype = $('#tkCtype').value || '';
      t.save = parseInt($('#tkSaveB').value) || 0;
      t.burning = $('#tkBurn').checked;
    }
    if (t.type === 'pc'){
      const inv = { slots: Math.max(1, parseInt($('#tkSlots').value) || 5), items: (S.tkInv.items || []).filter(i => (i.name || '').trim()) };
      if (inv.items.length > inv.slots){ toast('Hay ' + inv.items.length + ' objetos y solo ' + inv.slots + ' casillas: amplía el inventario', true); btn.disabled = false; return; }
      Object.assign(t, {
        cls: $('#tkCls').value || '', race: $('#tkRace').value || '',
        atk: parseInt($('#tkAtk').value) || 0, dmg: ($('#tkDmg').value || '').trim() || '1d6',
        range: Math.max(1, parseInt($('#tkRange').value) || 1), moveDie: ($('#tkMove').value || '').trim() || '1d6',
        inventory: inv
      });
    }
    if (old && old.ownerId && t.type === 'pc'){ t.ownerId = old.ownerId; t.ownerName = old.ownerName || ''; }
    const lp = LIGHT_PRESETS[$('#tkLight').value];
    if (lp) Object.assign(t, { lightKind: $('#tkLight').value, lightBright: lp.b, lightDim: lp.d, lightColor: lp.c });
    await DB.doc('tokens/' + id).set(t);
    if (t.type === 'pc' && !S.localMode){ try { await rpc('token_recalc', { tid: id }); } catch(e){ toast('CA: ' + e.message, true); } }
    $('#tokenModal').classList.remove('open'); S.fogDirty = true;
  } catch(e){
    toast('No se pudo guardar: ' + (e && e.message ? e.message : e), true);
  }
  btn.disabled = false;
};
$('#tkDelete').onclick = () => {
  if (!S.editingToken) return;
  DB.doc('tokens/' + S.editingToken).delete().catch(() => {});
  $('#tokenModal').classList.remove('open');
};
$('#tkDup').onclick = () => {
  const t = S.tokens[S.editingToken]; if (!t) return;
  const m = activeMap(); const g = gridOf(m);
  const copy = Object.assign({}, t, { x: t.x + g, y: t.y, name: nextName(t.name) });
  delete copy.id; delete copy.ownerId; delete copy.ownerName;
  DB.doc('tokens/' + uuid()).set(copy).catch(() => {});
  toast('Token duplicado');
};
function nextName(n){
  const m = n.match(/^(.*?)(\d+)$/);
  if (m) return m[1] + (parseInt(m[2]) + 1);
  return n + ' 2';
}
function viewCenterSnap(m){
  const r = cv.getBoundingClientRect();
  const c = screenToMap(r.width / 2, r.height / 2);
  const g = gridOf(m);
  return snapToken(m, { size: 1 }, clamp(c.x, g, (S.media.w || 1000) - g), clamp(c.y, g, (S.media.h || 1000) - g));
}

/* --- iniciativa --- */
function renderCombatBadge(){
  const g = gameDoc();
  const c = g ? g.combat : null;
  const b = $('#roundBadge');
  if (c && c.active){
    b.style.display = '';
    const cur = c.entries[c.turn];
    b.textContent = '⚔ Ronda ' + c.round + (cur ? ' · ' + cur.name : '');
  } else if (g && g.round && g.round.active){
    const m = activeMap();
    const pcs = m ? gameTokens(m.id).filter(t => t.type === 'pc' && !t.hidden) : [];
    const done = g.round.done || {};
    b.style.display = '';
    b.textContent = '🎲 Ronda ' + (g.round.n || 1) + ' · ' + pcs.filter(t => done[t.id]).length + '/' + pcs.length + ' han actuado';
  } else b.style.display = 'none';
}
function renderInitPanel(p){
  const g = gameDoc();
  const c = (g && g.combat) || { active: false, round: 1, turn: 0, entries: [] };
  let html = roundCtlHtml();
  if (S.isDM){
    html += '<div class="row">' +
      (c.active
        ? '<button id="btnNextTurn" class="primary grow">⏭ Siguiente turno</button><button id="btnEndCombat" class="danger">Fin</button>'
        : '<button id="btnStartCombat" class="primary grow"' + (c.entries.length ? '' : ' disabled') + '>⚔ Iniciar combate</button>') +
      '</div>' +
      '<div class="row" style="margin-top:6px"><button class="small" id="btnAddFromMap">＋ Tokens del mapa</button><button class="small" id="btnRollInit">🎲 Tirar iniciativas</button><button class="small" id="btnClearInit">Vaciar</button></div>' +
      '<div class="row" style="margin-top:6px"><input id="addManualName" class="grow" placeholder="Añadir combatiente…"><button class="small" id="btnAddManual">＋</button></div>';
  }
  html += '<div class="section-title">Orden de iniciativa' + (c.active ? ' · ronda ' + c.round : '') + '</div>';
  if (!c.entries.length) html += '<div class="muted">Sin combatientes. ' + (S.isDM ? 'Añádelos desde el mapa o manualmente.' : '') + '</div>';
  const order = c.entries.map((e, i) => ({ e, i })).sort((a, b) => (b.e.init || 0) - (a.e.init || 0));
  order.forEach(({ e, i }) => {
    const activeTurn = c.active && i === c.turn;
    html += '<div class="init-entry' + (activeTurn ? ' active-turn' : '') + '">' +
      (S.isDM ? '<input class="init-val" type="number" data-i="' + i + '" value="' + (e.init || 0) + '">' : '<b style="width:34px;text-align:center">' + (e.init || 0) + '</b>') +
      '<div class="grow"><b>' + esc(e.name) + '</b>' +
      '<div class="mini">PV ' + (e.hp == null ? '—' : e.hp + '/' + (e.hpMax || '?')) + '</div>' +
      '<div class="conds">' + (e.conds || []).map(cd => '<span class="cond" data-i="' + i + '" data-c="' + esc(cd) + '">' + esc(cd) + (S.isDM ? ' ✕' : '') + '</span>').join('') + '</div></div>' +
      (S.isDM ? '<div style="display:flex;flex-direction:column;gap:3px">' +
        '<div class="row"><button class="small hp-adj" data-i="' + i + '" data-d="-1">−</button><button class="small hp-adj" data-i="' + i + '" data-d="1">＋</button></div>' +
        '<div class="row"><select class="cond-add" data-i="' + i + '"><option value="">☠＋</option>' + CONDS.map(cd => '<option>' + cd + '</option>').join('') + '</select><button class="small rm-entry" data-i="' + i + '">🗑</button></div></div>' : '') +
      '</div>';
  });
  p.innerHTML = html;
  bindRoundCtl();
  if (!S.isDM) return;
  const C = () => JSON.parse(JSON.stringify((gameDoc() && gameDoc().combat) || { active: false, round: 1, turn: 0, entries: [] }));
  const save = cc => saveGame({ combat: cc });
  const bsc = $('#btnStartCombat'); if (bsc) bsc.onclick = () => { const cc = C(); cc.active = true; cc.round = 1; cc.turn = topIdx(cc); save(cc); };
  const bnt = $('#btnNextTurn'); if (bnt) bnt.onclick = () => {
    const cc = C(); if (!cc.entries.length) return;
    const order2 = cc.entries.map((e, i) => ({ e, i })).sort((a, b) => (b.e.init || 0) - (a.e.init || 0));
    const pos = order2.findIndex(o => o.i === cc.turn);
    const nxt = (pos + 1) % order2.length;
    if (nxt === 0) cc.round++;
    cc.turn = order2[nxt].i; save(cc);
  };
  const bec = $('#btnEndCombat'); if (bec) bec.onclick = () => { const cc = C(); cc.active = false; save(cc); };
  function topIdx(cc){
    let best = 0, bi = -Infinity;
    cc.entries.forEach((e, i) => { if ((e.init || 0) > bi){ bi = e.init || 0; best = i; } });
    return best;
  }
  $('#btnAddFromMap').onclick = () => {
    const m = activeMap(); if (!m){ toast('Activa un mapa primero', true); return; }
    const cc = C();
    gameTokens(m.id).forEach(t => {
      if (!cc.entries.some(e => e.tokenId === t.id))
        cc.entries.push({ id: uuid(), tokenId: t.id, name: t.name, init: 0, hp: t.hp, hpMax: t.hpMax, conds: [] });
    });
    save(cc);
  };
  $('#btnAddManual').onclick = () => {
    const name = $('#addManualName').value.trim();
    if (!name) return;
    const cc = C(); cc.entries.push({ id: uuid(), name, init: 0, hp: null, hpMax: null, conds: [] }); save(cc);
  };
  $('#btnRollInit').onclick = () => {
    const cc = C();
    cc.entries.forEach(e => { if (!e.init) e.init = 1 + Math.floor(Math.random() * 20); });
    save(cc); toast('Iniciativas tiradas (d20)');
  };
  $('#btnClearInit').onclick = () => { save({ active: false, round: 1, turn: 0, entries: [] }); };
  $$('.init-val').forEach(inp => inp.onchange = () => { const cc = C(); cc.entries[inp.dataset.i].init = parseInt(inp.value) || 0; save(cc); });
  $$('.hp-adj').forEach(b => b.onclick = () => {
    const cc = C(); const e = cc.entries[b.dataset.i];
    e.hp = (e.hp || 0) + parseInt(b.dataset.d); save(cc);
    if (e.tokenId && S.tokens[e.tokenId]) dmSetHp(S.tokens[e.tokenId], e.hp);
  });
  $$('select.cond-add').forEach(sel => sel.onchange = () => {
    const pick = sel.value; if (!pick) return;
    const cc = C(); const e = cc.entries[sel.dataset.i];
    e.conds = e.conds || []; if (!e.conds.includes(pick)) e.conds.push(pick); save(cc);
  });
  $$('.cond').forEach(sp => sp.onclick = () => {
    if (!S.isDM) return;
    const cc = C(); const e = cc.entries[sp.dataset.i];
    e.conds = (e.conds || []).filter(x => x !== sp.dataset.c); save(cc);
  });
  $$('.rm-entry').forEach(b => b.onclick = () => { const cc = C(); cc.entries.splice(b.dataset.i, 1); if (cc.turn >= cc.entries.length) cc.turn = 0; save(cc); });
}

/* --- dados --- */
/* Dados 3D (dice3d.js + three.js/cannon-es): se cargan solo cuando hacen falta */
let dice3dMod = null;
const dice3dSeen = new Set();
function dice3dEnabled(){ return lsGet('vtt_dice3d') !== 0; }
function loadDice3D(){ if (!dice3dMod) dice3dMod = import('/dice3d.js').catch(e => { console.warn('dados 3D', e); dice3dMod = null; return null; }); return dice3dMod; }
/* Dados individuales de una tirada: campo `dice` o, en tiradas antiguas/del servidor, sacados del texto */
function diceOfRoll(r){
  if (Array.isArray(r.dice)) return r.dice;
  const out = [], det = String(r.detail || ''), frm = String(r.formula || '');
  const re = /(\d+)d(\d+) \[([\d, ]+)\]/g; let m;
  while ((m = re.exec(det))) m[3].split(',').forEach(v => out.push({ f: +m[2], v: +v }));
  if (out.length) return out;
  const br = det.match(/^\[([\d, ]+)\]/);
  if (br && (/vs CA/.test(det) || /d20/.test(frm) || /⚔/.test(frm))) return br[1].split(',').map(v => ({ f: 20, v: +v }));
  // p. ej. «Movimiento (1d6) · Aria» con total = el dado (sin modificadores)
  const all = frm.match(/\d*d\d+/g) || [], one = frm.match(/(?:^|[^\w])1?d(\d+)(?!\d|\s*[+-]\s*\d)/);
  if (all.length === 1 && one && Number.isFinite(+r.total) && +r.total >= 1 && +r.total <= +one[1]) return [{ f: +one[1], v: +r.total }];
  return [];
}
function animateNewRolls(list){
  const now = Date.now();
  for (const r of list){
    if (dice3dSeen.has(r.id)) continue;
    dice3dSeen.add(r.id);
    if (r.msg != null || r.total == null || (r.gameId || null) !== (S.gameId || null)) continue;
    if (Math.abs(now - (r.ts || 0)) > 15000) continue;          // solo tiradas recién hechas
    const mine = r.uid === S.uid;
    if (r.priv && !mine && !S.isDM) continue;                   // las ocultas solo las ve quien tira y el DM
    if (!dice3dEnabled()) continue;
    const dice = diceOfRoll(r).filter(d => [4, 6, 8, 10, 12, 20, 100].includes(+d.f));
    if (!dice.length) continue;
    // crítico / pifia: un único d20 (o ventaja/desventaja, donde el total es el dado elegido)
    let nat = null;
    if (dice.length === 1 && +dice[0].f === 20) nat = +dice[0].v;
    else if (dice.length === 2 && dice.every(d => +d.f === 20) && /ventaja/.test(r.formula || '')) nat = +r.total;
    const crit = nat === 20 ? 'hit' : nat === 1 ? 'miss' : null;
    loadDice3D().then(mod => mod && mod.play({
      dice, seed: r.id, color: r.uid === 'npc' ? 'npc' : (r.uid || r.who),
      label: (r.who || 'Aventurero') + (mine ? ' (tú)' : '') + (r.priv ? ' 🤫' : ''),
      total: r.total, sub: r.formula, crit, mount: $('#stage'), inset: { top: 12, right: 64, bottom: 12, left: 12 }
    }));
  }
  if (dice3dSeen.size > 2000) dice3dSeen.clear();
}
function rollDice(n, faces){ const r = []; for (let i = 0; i < n; i++) r.push(1 + Math.floor(Math.random() * faces)); return r; }
function parseFormula(f){
  f = (f || '').replace(/\s/g, '').toLowerCase();
  if (!f || !/^[0-9d+\-]+$/.test(f)) return null;
  const parts = f.match(/[+-]?[^+-]+/g); if (!parts) return null;
  let total = 0; const detail = [], dice = [];
  for (const part of parts){
    const sign = part.startsWith('-') ? -1 : 1;
    const body = part.replace(/^[+-]/, '');
    const dm = body.match(/^(\d*)d(\d+)$/);
    if (dm){
      const n = clamp(parseInt(dm[1] || '1'), 1, 100), faces = clamp(parseInt(dm[2]), 2, 1000);
      const rolls = rollDice(n, faces);
      rolls.forEach(v => dice.push({ f: faces, v }));
      total += sign * rolls.reduce((a, b) => a + b, 0);
      detail.push((sign < 0 ? '−' : '') + n + 'd' + faces + ' [' + rolls.join(', ') + ']');
    } else if (/^\d+$/.test(body)){
      total += sign * parseInt(body);
      detail.push((sign < 0 ? '−' : '+') + body);
    } else return null;
  }
  return { total, detail: detail.join('  '), dice };
}
function publishRoll(formula, res, priv){
  const doc = { ts: Date.now(), uid: S.uid, who: myName(), gameId: S.gameId, formula, total: res.total, detail: res.detail, priv: !!priv };
  if (res.dice && res.dice.length) doc.dice = res.dice.slice(0, 40);
  DB.doc('rolls/' + uuid()).set(doc).catch(e => toast('No se pudo publicar la tirada: ' + (e.message || e), true));
}
function renderDicePanel(p){
  let html = '<div class="dice-grid">' +
    ['d4','d6','d8','d10','d12','d20','d100'].map(d => '<button class="qd" data-d="' + d + '">' + d + '</button>').join('') +
    '<button id="d20adv" title="2d20, se queda el mayor">Ventaja</button></div>' +
    '<div class="row"><button id="d20dis" class="small" style="flex:1" title="2d20, se queda el menor">d20 desventaja</button>' +
    '<label class="row" style="gap:4px"><input type="checkbox" id="rollPriv" style="width:auto"> oculta</label>' +
    '<label class="row" style="gap:4px" title="Ver los dados rodar en 3D sobre el mapa"><input type="checkbox" id="dice3dOn" style="width:auto"' + (dice3dEnabled() ? ' checked' : '') + '> 3D</label></div>' +
    '<div class="row" style="margin-top:8px"><input id="formula" class="grow" placeholder="2d6+3, 1d8+1d6+2…"><button class="primary" id="btnRoll">Tirar</button></div>' +
    '<div class="row" style="margin-top:8px"><input id="chatMsg" class="grow" placeholder="Mensaje al grupo…"><button id="btnMsg">💬</button></div>' +
    '<div class="section-title">Registro</div><div id="log">';
  S.rolls.filter(r => (r.gameId || null) === (S.gameId || null)).forEach(r => {
    const mine = r.uid === S.uid;
    if (r.priv && !mine && !S.isDM) return;
    const who = esc(r.who || 'Aventurero') + (mine ? ' (tú)' : '');
    if (r.msg != null){
      html += '<div class="roll-entry"><span class="who">' + who + '</span><div>' + esc(r.msg) + '</div></div>';
    } else {
      html += '<div class="roll-entry' + (r.priv ? ' priv' : '') + '"><span class="total">' + r.total + '</span><span class="who">' + who + (r.priv ? ' 🤫' : '') + '</span>' +
        '<div class="detail">' + esc(r.formula) + ' → ' + esc(r.detail || '') + '</div></div>';
    }
  });
  html += '</div>';
  p.innerHTML = html;
  const doRoll = f => {
    const res = parseFormula(f);
    if (!res){ toast('Fórmula no válida. Ej: 2d6+3', true); return; }
    publishRoll(f, res, $('#rollPriv').checked);
  };
  $$('.qd').forEach(b => b.onclick = () => doRoll('1' + b.dataset.d));
  $('#btnRoll').onclick = () => doRoll($('#formula').value);
  $('#formula').addEventListener('keydown', e => { if (e.key === 'Enter') doRoll($('#formula').value); });
  $('#d20adv').onclick = () => {
    const r = rollDice(2, 20); const best = Math.max(r[0], r[1]);
    publishRoll('d20 ventaja', { total: best, detail: '[' + r.join(', ') + '] → mayor', dice: r.map(v => ({ f: 20, v })) }, $('#rollPriv').checked);
  };
  $('#d20dis').onclick = () => {
    const r = rollDice(2, 20); const worst = Math.min(r[0], r[1]);
    publishRoll('d20 desventaja', { total: worst, detail: '[' + r.join(', ') + '] → menor', dice: r.map(v => ({ f: 20, v })) }, $('#rollPriv').checked);
  };
  $('#dice3dOn').onchange = e => { lsSet('vtt_dice3d', e.target.checked ? 1 : 0); if (e.target.checked) loadDice3D(); };
  $('#btnMsg').onclick = sendMsg;
  $('#chatMsg').addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });
  function sendMsg(){
    const v = $('#chatMsg').value.trim(); if (!v) return;
    $('#chatMsg').value = '';
    DB.doc('rolls/' + uuid()).set({ ts: Date.now(), uid: S.uid, who: myName(), gameId: S.gameId, msg: v }).catch(() => {});
  }
}

/* ============ importador ============ */
function openImport(){
  $('#importModal').classList.add('open');
  $('#importSummary').style.display = 'none';
  $('#importCloseRow').style.display = '';
  S.pendingImport = null;
}
$('#impClose').onclick = () => $('#importModal').classList.remove('open');
$('#impCancel').onclick = () => { $('#importSummary').style.display = 'none'; $('#importCloseRow').style.display = ''; S.pendingImport = null; };
$('#emptyImportBtn').onclick = openImport;
const dz = $('#dropZone');
dz.onclick = () => $('#fileInput').click();
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handleFiles([...e.dataTransfer.files]); });
$('#fileInput').onchange = e => handleFiles([...e.target.files]);

async function handleFiles(files){
  if (!files.length) return;
  let jsonFile = null, mediaFile = null;
  for (const f of files){
    const n = f.name.toLowerCase();
    if (n.endsWith('.json') || n.endsWith('.dd2vtt') || n.endsWith('.uvtt') || n.endsWith('.df2vtt')) jsonFile = f;
    else if (f.type.startsWith('image/') || f.type.startsWith('video/')) mediaFile = f;
    else if (n.endsWith('.webm') || n.endsWith('.mp4')) mediaFile = f;
  }
  let parsed = { name: 'Mapa', grid: 70, walls: [], doorStates: {}, needsGrid: true };
  let mediaBlob = mediaFile, mediaType = mediaFile ? (mediaFile.type.startsWith('video') || /\.(mp4|webm)$/i.test(mediaFile.name) ? 'video' : 'image') : null;
  if (jsonFile){
    let j;
    try { j = JSON.parse(await jsonFile.text()); }
    catch(e){ toast('El JSON no se pudo leer: ' + e.message, true); return; }
    try {
      if (j && j.resolution && j.resolution.pixels_per_grid != null){
        parsed = parseUVTT(j);
        if (!mediaBlob && parsed._imageB64){
          mediaBlob = b64toBlob(parsed._imageB64); mediaType = 'image';
        }
      } else if (j && (Array.isArray(j.walls) || j.grid != null || j.width != null)){
        parsed = parseFoundry(j);
      } else { toast('JSON no reconocido: usa el export de Foundry o Universal VTT', true); return; }
    } catch(e){ toast('Error al interpretar el mapa: ' + e.message, true); return; }
    parsed.name = parsed.name || jsonFile.name.replace(/\.[^.]+$/, '');
  } else if (mediaFile){
    parsed.name = mediaFile.name.replace(/\.[^.]+$/, '');
  } else {
    toast('Selecciona el JSON del mapa y/o su imagen', true); return;
  }
  if (!mediaBlob){
    toast('Falta la imagen o el vídeo del mapa: selecciónalos junto al JSON', true); return;
  }
  const dims = await mediaDims(mediaBlob, mediaType);
  S.pendingImport = { parsed, mediaBlob, mediaType, w: dims.w, h: dims.h };
  $('#impName').value = parsed.name;
  $('#impGrid').value = parsed.grid || 70;
  $('#impOffX').value = 0; $('#impOffY').value = 0;
  $('#impGridRow').style.display = parsed.needsGrid ? 'flex' : 'none';
  $('#importInfo').innerHTML = '<b>' + esc(parsed.name) + '</b><div class="mini">' +
    (parsed.source || 'imagen suelta') + ' · ' + dims.w + '×' + dims.h + 'px · ' +
    parsed.walls.length + ' muros · ' + parsed.walls.filter(w => w.door).length + ' puertas · ' + (parsed.lights || []).length + ' luces · rejilla ' + (parsed.grid || '¿?') + 'px' +
    (mediaType === 'video' ? ' · 🎬 vídeo' : '') + '</div>';
  $('#importSummary').style.display = '';
  $('#importCloseRow').style.display = 'none';
  $('#impProgress').textContent = '';
}
function b64toBlob(b64){
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  let mime = 'image/png';
  if (arr[0] === 0xFF && arr[1] === 0xD8) mime = 'image/jpeg';
  if (arr[8] === 0x57 && arr[9] === 0x45) mime = 'image/webp';
  return new Blob([arr], { type: mime });
}
function mediaDims(blob, type){
  return new Promise(res => {
    const url = URL.createObjectURL(blob);
    if (type === 'video'){
      const v = document.createElement('video');
      v.onloadedmetadata = () => { res({ w: v.videoWidth, h: v.videoHeight }); URL.revokeObjectURL(url); };
      v.onerror = () => res({ w: 0, h: 0 });
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => { res({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => res({ w: 0, h: 0 });
      img.src = url;
    }
  });
}
function parseFoundry(j){
  const grid = (j.grid && typeof j.grid === 'object') ? (j.grid.size || 100) : (j.grid || j.gridSize || 100);
  const padding = (j.padding != null) ? j.padding : 0;
  let offX = 0, offY = 0;
  if (padding > 0 && j.width && j.height){
    offX = Math.ceil(j.width * padding / grid) * grid;
    offY = Math.ceil(j.height * padding / grid) * grid;
  }
  const doorStates = {};
  const dist = Number((j.grid && typeof j.grid === 'object' && j.grid.distance) || j.gridDistance) || 5;
  const lights = (j.lights || []).map(l => {
    const c = (l && l.config) || l || {};
    const bright = Number(c.bright != null ? c.bright : l.bright) || 0, dim = Number(c.dim != null ? c.dim : l.dim) || 0;
    if (!(Math.max(bright, dim) > 0) || l.hidden) return null;
    const col = c.color || l.tintColor;
    return { x: (Number(l.x) || 0) - offX, y: (Number(l.y) || 0) - offY, bright: Math.max(0, bright) / dist, dim: Math.max(bright, dim) / dist,
      color: HEX_RE.test(String(col || '')) ? col : '#ffb35c', alpha: clamp(Number(c.alpha != null ? c.alpha : l.tintAlpha) || 0.5, 0, 1) };
  }).filter(Boolean);
  const env = j.environment || {};
  let darkness = Number(j.darkness != null ? j.darkness : env.darknessLevel) || 0;
  if (lights.length && darkness < 0.05) darkness = 0.75;   // si trae luces pero escena clara: que se noten
  const walls = (j.walls || []).map((w, i) => {
    const c = w.c || [w.x1, w.y1, w.x2, w.y2];
    const sightRaw = (w.sight != null) ? w.sight : ((w.sense != null) ? w.sense : 20);
    if (w.door && (w.ds === 1)) doorStates[i] = true;
    return { x1: c[0] - offX, y1: c[1] - offY, x2: c[2] - offX, y2: c[3] - offY, door: w.door ? 1 : 0, sight: sightRaw === 0 ? 0 : 1 };
  });
  return { name: j.name || 'Mapa Foundry', grid, walls, doorStates, lights, darkness, needsGrid: false, source: 'Export de Foundry (Dungeon Alchemist)' };
}
function parseUVTT(j){
  const ppg = j.resolution.pixels_per_grid || 70;
  const origin = (j.resolution.map_origin) || { x: 0, y: 0 };
  const walls = [];
  const addPoly = line => {
    for (let i = 0; i < line.length - 1; i++){
      walls.push({
        x1: (line[i].x - origin.x) * ppg, y1: (line[i].y - origin.y) * ppg,
        x2: (line[i + 1].x - origin.x) * ppg, y2: (line[i + 1].y - origin.y) * ppg,
        door: 0, sight: 1
      });
    }
  };
  (j.line_of_sight || []).forEach(addPoly);
  (j.objects_line_of_sight || []).forEach(addPoly);
  const doorStates = {};
  (j.portals || []).forEach(p => {
    const b = p.bounds || [];
    for (let i = 0; i < b.length - 1; i++){
      const idx = walls.length;
      walls.push({
        x1: (b[i].x - origin.x) * ppg, y1: (b[i].y - origin.y) * ppg,
        x2: (b[i + 1].x - origin.x) * ppg, y2: (b[i + 1].y - origin.y) * ppg,
        door: 1, sight: 1
      });
      if (p.closed === false) doorStates[idx] = true;
    }
  });
  const lights = (j.lights || []).map(l => {
    const pos = l.position || {}, r = Number(l.range) || 0;
    if (!(r > 0)) return null;
    const hx = String(l.color || '').replace('#', '');
    const col = /^[0-9a-f]{8}$/i.test(hx) ? '#' + hx.slice(2) : /^[0-9a-f]{6}$/i.test(hx) ? '#' + hx : '#ffb35c';
    return { x: ((Number(pos.x) || 0) - origin.x) * ppg, y: ((Number(pos.y) || 0) - origin.y) * ppg, bright: r / 2, dim: r, color: col, alpha: clamp(Number(l.intensity) || 0.5, 0, 1) };
  }).filter(Boolean);
  return { name: j.name || 'Mapa UVTT', grid: ppg, walls, doorStates, lights, darkness: lights.length ? 0.75 : 0, needsGrid: false, source: 'Universal VTT', _imageB64: j.image || null };
}
$('#impCreate').onclick = async () => {
  const pi = S.pendingImport; if (!pi) return;
  const btn = $('#impCreate'); btn.disabled = true;
  const prog = $('#impProgress');
  try {
    let assetUrl = null;
    if (S.localMode){
      assetUrl = URL.createObjectURL(pi.mediaBlob);
    } else {
      prog.textContent = 'Subiendo mapa (' + Math.round(pi.mediaBlob.size / 1048576 * 10) / 10 + ' MB)…';
      assetUrl = (await uploadAsset(pi.mediaBlob)).url;
    }
    prog.textContent = 'Creando mapa…';
    const id = uuid();
    const doc = {
      name: ($('#impName').value.trim() || pi.parsed.name || 'Mapa').slice(0, 80),
      ownerId: S.uid, gameId: S.localMode ? null : S.gameId,
      assetUrl, mediaType: pi.mediaType,
      w: pi.w, h: pi.h,
      grid: parseInt($('#impGrid').value) || pi.parsed.grid || 70,
      gridOffX: parseInt($('#impOffX').value) || 0,
      gridOffY: parseInt($('#impOffY').value) || 0,
      wallOffX: 0, wallOffY: 0,
      walls: pi.parsed.walls, doorStates: pi.parsed.doorStates || {},
      fog: pi.parsed.walls.length ? true : false,
      lights: pi.parsed.lights || [], darkness: pi.parsed.darkness || 0, rememberExplored: true,
      defaultVision: 12, showGrid: true, createdAt: Date.now()
    };
    await DB.doc('maps/' + id).set(doc);
    saveGame({ activeMapId: id });
    $('#importModal').classList.remove('open');
    toast('Mapa «' + doc.name + '» importado' + (doc.walls.length ? ' con ' + doc.walls.length + ' muros' : ''));
  } catch(e){
    toast('Error al importar: ' + (e && e.message ? e.message : e), true);
  }
  btn.disabled = false; prog.textContent = '';
};

/* ============ luces y visión en la oscuridad ============ */
const DARK_SEE = 0.55;   // desde esta oscuridad hace falta luz o visión en la oscuridad para ver
const DV_RACES = { 'Elfo': 12, 'Enano': 12, 'Gnomo': 12, 'Semielfo': 12, 'Semiorco': 12, 'Tiflin': 12 };
const LIGHT_PRESETS = {
  torch:   { n: 'Antorcha',    b: 4, d: 8,  c: '#ff9b42' },
  lantern: { n: 'Linterna',    b: 6, d: 12, c: '#ffc66b' },
  candle:  { n: 'Vela',        b: 1, d: 2,  c: '#ffb35c' },
  spell:   { n: 'Conjuro Luz', b: 4, d: 8,  c: '#e6f0ff' }
};
function mapDarkness(m){ return clamp(Number(m && m.darkness) || 0, 0, 1); }
function darkvisionOf(t){
  if (t.darkvision != null && t.darkvision !== '') return Math.max(0, Number(t.darkvision) || 0);
  return DV_RACES[t.race] || 0;
}
let lightCache = { key: null, list: [] };
function mapLights(m, segs){
  const g = gridOf(m), k = m.lightScale > 0 ? m.lightScale : 1;
  const offX = m.wallOffX || 0, offY = m.wallOffY || 0, off = m.lightsOff || {};
  const key = [m.id, JSON.stringify(m.doorStates || {}), offX, offY, JSON.stringify(off), k, g, (m.lights || []).length, S.media.w, S.media.h].join('|');
  if (lightCache.key !== key){
    lightCache = { key, list: (m.lights || []).map((l, i) => {
      if (off[i]) return null;
      const dim = Math.max(l.dim, l.bright) * g * k;
      if (!(dim > 0)) return null;
      const x = l.x + offX, y = l.y + offY;
      return { x, y, bright: l.bright * g * k, dim, color: l.color || '#ffb35c', alpha: l.alpha == null ? 0.5 : l.alpha, poly: visPolygon(x, y, dim, segs) };
    }).filter(Boolean) };
  }
  const out = lightCache.list.slice();
  gameTokens(m.id).forEach(t => {
    if (t.hidden || !(t.lightDim > 0)) return;
    const dim = Math.max(t.lightDim, t.lightBright || 0) * g;
    out.push({ x: t.x, y: t.y, bright: (t.lightBright || 0) * g, dim, color: t.lightColor || '#ff9b42', alpha: 0.45, poly: visPolygon(t.x, t.y, dim, segs) });
  });
  return out;
}
function drawLightMarkers(m, g){
  const off = m.lightsOff || {}, k = m.lightScale > 0 ? m.lightScale : 1;
  (m.lights || []).forEach((l, i) => {
    const x = l.x + (m.wallOffX || 0), y = l.y + (m.wallOffY || 0), on = !off[i];
    ctx.save();
    ctx.strokeStyle = on ? 'rgba(255,200,90,.55)' : 'rgba(160,160,160,.35)'; ctx.lineWidth = 1.5 / S.cam.s; ctx.setLineDash([5 / S.cam.s, 5 / S.cam.s]);
    ctx.beginPath(); ctx.arc(x, y, Math.max(l.dim, l.bright) * g * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    const r = Math.max(10, g * 0.18);
    ctx.fillStyle = on ? 'rgba(201,162,39,.95)' : 'rgba(60,60,60,.9)'; ctx.strokeStyle = '#0008'; ctx.lineWidth = 2 / S.cam.s;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = (r * 1.1) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = on ? 1 : 0.5; ctx.fillText('💡', x, y + 1);
    ctx.restore();
  });
}
function hitLight(mx, my){
  const m = activeMap(); if (!m) return null;
  const g = gridOf(m), ls = m.lights || [];
  for (let i = 0; i < ls.length; i++){
    const x = ls[i].x + (m.wallOffX || 0), y = ls[i].y + (m.wallOffY || 0);
    if (Math.hypot(mx - x, my - y) <= Math.max(12, g * 0.22)) return i;
  }
  return null;
}

/* ============ zonas exploradas guardadas (por jugador y mapa) ============ */
const expSave = { timers: {} };
function expLsKey(mapId){ return 'vtt_exp_' + S.uid + '_' + mapId; }
async function loadExplored(m, c, key){
  const apply = rec => {
    if (!rec || typeof rec.png !== 'string' || !rec.png.startsWith('data:image/png;base64,')) return;
    if ((rec.rv || 0) !== (m.exploredReset || 0)) return;   // guardado antes de un reinicio del DM
    const img = new Image();
    img.onload = () => { if (S.explored[key] !== c) return; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); S.fogDirty = true; needsDraw(); };
    img.src = rec.png;
  };
  apply(lsGet(expLsKey(m.id)));
  if (S.localMode || !SB) return;
  try {
    const { data, error } = await SB.from('explored').select('data').eq('user_id', S.uid).eq('map_id', m.id).maybeSingle();
    if (!error && data) apply(data.data);
  } catch(e){}
}
function scheduleExploredSave(mapId){
  clearTimeout(expSave.timers[mapId]);
  expSave.timers[mapId] = setTimeout(() => saveExplored(mapId), 4000);
}
function saveExplored(mapId){
  delete expSave.timers[mapId];
  const c = S.explored[(S.gameId || 'x') + ':' + mapId];
  const m = S.maps[mapId];
  if (!c || !m) return;
  let png; try { png = c.toDataURL('image/png'); } catch(e){ return; }
  if (png.length > 900000) return;     // mapa enorme: no se guarda
  const rec = { ts: Date.now(), rv: m.exploredReset || 0, png };
  lsSet(expLsKey(mapId), rec);
  if (!S.localMode && SB && S.gameId){
    SB.from('explored').upsert({ user_id: S.uid, map_id: mapId, game_id: S.gameId, data: rec }).then(({ error }) => { if (error) console.warn('explorado', error.message); });
  }
}
function flushExploredSaves(){ Object.keys(expSave.timers).forEach(id => { clearTimeout(expSave.timers[id]); saveExplored(id); }); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushExploredSaves(); });
window.addEventListener('pagehide', flushExploredSaves);
function checkExploredResets(){
  Object.keys(S.explored).forEach(key => {
    const mapId = key.slice(key.indexOf(':') + 1), m = S.maps[mapId], c = S.explored[key];
    if (!m || !c) return;
    const r = m.exploredReset || 0;
    if (r !== (c._reset || 0)){
      c._reset = r;
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
      clearTimeout(expSave.timers[mapId]); delete expSave.timers[mapId];
      lsSet(expLsKey(mapId), null);
      S.fogDirty = true;
    }
  });
}

/* ============ regla de medir (varios puntos, la ven todos) ============ */
function cellCenter(m, p){
  const g = gridOf(m), ox = m.gridOffX || 0, oy = m.gridOffY || 0;
  return { x: ox + (Math.floor((p.x - ox) / g) + 0.5) * g, y: oy + (Math.floor((p.y - oy) / g) + 0.5) * g };
}
function gridVertex(m, p){
  const g = gridOf(m), ox = m.gridOffX || 0, oy = m.gridOffY || 0;
  return { x: ox + Math.round((p.x - ox) / g) * g, y: oy + Math.round((p.y - oy) / g) * g };
}
function segCells(a, b, g){ return Math.max(Math.abs(Math.round((b.x - a.x) / g)), Math.abs(Math.round((b.y - a.y) / g))); }
function rulerPts(r){
  const pts = r.pts.slice();
  if (r.cur){ const l = pts[pts.length - 1]; if (!l || l.x !== r.cur.x || l.y !== r.cur.y) pts.push(r.cur); }
  return pts;
}
function rulerFeet(pts, g){ let c = 0; for (let i = 1; i < pts.length; i++) c += segCells(pts[i - 1], pts[i], g); return c * 5; }
function setRulerMode(on){
  S.rulerMode = !!on;
  if (on) setTplMode(false);
  if (!on && S.ruler){ S.ruler = null; rulerSend(true); }
  $('#btnRuler').classList.toggle('on', S.rulerMode);
  $('#rulerBar').classList.toggle('open', S.rulerMode);
  cv.style.cursor = S.rulerMode ? 'crosshair' : '';
  updateRulerBar(); needsDraw();
}
function updateRulerBar(){
  const m = activeMap(), r = S.ruler;
  if (!m || !r){ $('#rulerTotal').textContent = 'Toca el mapa para medir'; return; }
  const pts = rulerPts(r), ft = rulerFeet(pts, gridOf(m));
  $('#rulerTotal').textContent = ft + ' ft · ' + (ft / 5) + ' casillas' + (pts.length > 2 ? ' · ' + (pts.length - 1) + ' tramos' : '');
}
function rulerDown(p){
  const m = activeMap(), c = cellCenter(m, p);
  if (!S.ruler) S.ruler = { pts: [c], cur: c, down: true };
  else { S.ruler.cur = c; S.ruler.down = true; }
  updateRulerBar(); rulerSend(); needsDraw();
}
function rulerMove(p, hover){
  const r = S.ruler, m = activeMap();
  if (!r || !m || !(r.down || hover)) return;
  const c = cellCenter(m, p);
  if (r.cur && r.cur.x === c.x && r.cur.y === c.y) return;
  r.cur = c; updateRulerBar(); rulerSend(); needsDraw();
}
function rulerUp(ok){
  const r = S.ruler; if (!r) return;
  r.down = false;
  const last = r.pts[r.pts.length - 1];
  if (ok && r.cur && (r.cur.x !== last.x || r.cur.y !== last.y) && r.pts.length < 40) r.pts.push({ x: r.cur.x, y: r.cur.y });
  updateRulerBar(); rulerSend(true); needsDraw();
}
let rulerT = 0, rulerTimer = null;
function rulerSend(force){
  if (!GCH || S.projector) return;
  const go = () => {
    rulerT = performance.now(); rulerTimer = null;
    const m = activeMap(), r = S.ruler;
    try { GCH.send({ type: 'broadcast', event: 'ruler', payload: { uid: S.uid, name: myName(), mapId: m ? m.id : null, color: myColor(), pts: r ? rulerPts(r).map(p => [Math.round(p.x), Math.round(p.y)]) : [] } }); } catch(e){}
  };
  if (force || performance.now() - rulerT > 90){ clearTimeout(rulerTimer); go(); }
  else if (!rulerTimer) rulerTimer = setTimeout(go, 90);
}
function onRemoteRuler(d){
  if (!d || typeof d.uid !== 'string') return;
  const pts = Array.isArray(d.pts) ? d.pts.slice(0, 41).filter(p => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])).map(p => ({ x: +p[0], y: +p[1] })) : [];
  if (pts.length < 1) delete S.rulers[d.uid];
  else S.rulers[d.uid] = { name: String(d.name || 'Aventurero').slice(0, 30), mapId: d.mapId, color: HEX_RE.test(String(d.color || '')) ? d.color : '#7fb3d5', pts, t: performance.now() };
  needsDraw();
}
function myColor(){ const pc = myPC(); return S.isDM ? '#c9a227' : (pc && pc.color) || '#7fb3d5'; }
function drawRulers(m, g){
  const now = performance.now();
  Object.keys(S.rulers).forEach(k => { if (now - S.rulers[k].t > 20000) delete S.rulers[k]; });
  Object.values(S.rulers).forEach(r => { if (r.mapId === m.id) drawRuler(r.pts, g, r.color, r.name); });
  if (S.ruler) drawRuler(rulerPts(S.ruler), g, myColor(), null);
}
function drawRuler(pts, g, color, who){
  if (!pts.length) return;
  const s = S.cam.s;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 7 / s;
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 3.5 / s;
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
  let acc = 0;
  pts.forEach((p, i) => {
    if (i) acc += segCells(pts[i - 1], p, g) * 5;
    ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2 / s;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6 / s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (i){
      const last = i === pts.length - 1;
      const txt = acc + ' ft' + (last && who ? ' · ' + who : '');
      ctx.font = '700 ' + (last ? 15 : 12) / s + 'px Inter'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const w = ctx.measureText(txt).width, pad = 5 / s, h = (last ? 22 : 18) / s;
      ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(p.x + 10 / s, p.y - h / 2, w + pad * 2, h);
      ctx.fillStyle = last ? '#fff' : '#ddd'; ctx.fillText(txt, p.x + 10 / s + pad, p.y + 1 / s);
    }
  });
  ctx.restore();
}
$('#btnRuler').onclick = () => setRulerMode(!S.rulerMode);
$('#rulerExit').onclick = () => setRulerMode(false);
$('#rulerClear').onclick = () => { S.ruler = null; updateRulerBar(); rulerSend(true); needsDraw(); };
$('#rulerUndo').onclick = () => {
  const r = S.ruler; if (!r) return;
  r.cur = null;
  if (r.pts.length > 1) r.pts.pop(); else S.ruler = null;
  updateRulerBar(); rulerSend(true); needsDraw();
};
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || /input|textarea|select/i.test((e.target && e.target.tagName) || '')) return;
  if (S.rulerMode){ if (S.ruler){ S.ruler = null; updateRulerBar(); rulerSend(true); needsDraw(); } else setRulerMode(false); }
  else if (S.tplMode) setTplMode(false);
});

/* ============ plantillas de área ============ */
const TPL_NAMES = { circle: 'Círculo', cone: 'Cono', line: 'Línea', cube: 'Cubo' };
const CONE_HALF = Math.atan(0.5);   // 5e: el cono es tan ancho como largo
function setTplMode(on){
  S.tplMode = !!on;
  if (on) setRulerMode(false);
  S.tplDraft = null;
  $('#btnTpl').classList.toggle('on', S.tplMode);
  $('#tplBar').classList.toggle('open', S.tplMode);
  cv.style.cursor = S.tplMode ? 'crosshair' : '';
  renderTplBar(); needsDraw();
}
function canEditTpl(t){ return S.isDM || t.uid === S.uid; }
function mapTemplates(m){ return S.templates.filter(t => t.mapId === m.id && (t.gameId || null) === (S.gameId || null)); }
function renderTplBar(){
  $$('#tplBar .tpl-shapes button').forEach(b => b.classList.toggle('on', b.dataset.shape === S.tplShape));
  const m = activeMap();
  const n = m ? mapTemplates(m).filter(canEditTpl).length : 0;
  const cb = $('#tplClear');
  cb.textContent = '🗑' + (n ? ' ' + n : '');
  cb.title = S.isDM ? 'Borrar todas las plantillas de este mapa' : 'Borrar tus plantillas';
  cb.disabled = !n;
  $('#tplHint').textContent = S.tplDraft ? '' : TPL_NAMES[S.tplShape] + ': arrastra desde el origen';
}
$$('#tplBar .tpl-shapes button').forEach(b => b.onclick = () => { S.tplShape = b.dataset.shape; renderTplBar(); });
$('#btnTpl').onclick = () => setTplMode(!S.tplMode);
$('#tplExit').onclick = () => setTplMode(false);
$('#tplClear').onclick = e => armConfirm(e.currentTarget, async () => {
  const m = activeMap(); if (!m) return;
  const list = mapTemplates(m).filter(canEditTpl);
  for (const t of list) await DB.doc('templates/' + t.id).delete().catch(err => toast(err.message, true));
  renderTplBar();
});
function tplFromDraft(m, d){
  const g = gridOf(m), dx = d.ex - d.x, dy = d.ey - d.y;
  const len = Math.max(5, Math.round(Math.hypot(dx, dy) / g) * 5);
  const step = Math.PI / 12;   // 15°
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { shape: d.shape, x: d.x, y: d.y, len, angle, dx: dx < 0 ? -1 : 1, dy: dy < 0 ? -1 : 1 };
}
function tplContains(t, px, py, g){
  const L = t.len / 5 * g, eps = g * 0.02;
  const vx = px - t.x, vy = py - t.y;
  if (t.shape === 'circle') return Math.hypot(vx, vy) <= L + eps;
  if (t.shape === 'cube'){
    const x0 = Math.min(t.x, t.x + t.dx * L), x1 = Math.max(t.x, t.x + t.dx * L);
    const y0 = Math.min(t.y, t.y + t.dy * L), y1 = Math.max(t.y, t.y + t.dy * L);
    return px >= x0 - eps && px <= x1 + eps && py >= y0 - eps && py <= y1 + eps;
  }
  const ux = Math.cos(t.angle || 0), uy = Math.sin(t.angle || 0);
  const along = vx * ux + vy * uy, perp = Math.abs(-vx * uy + vy * ux);
  if (t.shape === 'line') return along >= -eps && along <= L + eps && perp <= g / 2 + eps;
  const d = Math.hypot(vx, vy);
  if (d < 1e-6 || d > L + eps || along <= 0) return false;
  return Math.atan2(perp, along) <= CONE_HALF + 0.01;
}
function tplCells(t, m){
  const g = gridOf(m), ox = m.gridOffX || 0, oy = m.gridOffY || 0, L = t.len / 5 * g;
  const out = [];
  const i0 = Math.floor((t.x - L - ox) / g) - 1, i1 = Math.ceil((t.x + L - ox) / g) + 1;
  const j0 = Math.floor((t.y - L - oy) / g) - 1, j1 = Math.ceil((t.y + L - oy) / g) + 1;
  if ((i1 - i0) * (j1 - j0) > 40000) return out;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++){
    const cx = ox + (i + 0.5) * g, cy = oy + (j + 0.5) * g;
    if (tplContains(t, cx, cy, g)) out.push({ x: cx - g / 2, y: cy - g / 2 });
  }
  return out;
}
function tplOutline(t, g){
  const L = t.len / 5 * g, a = t.angle || 0;
  ctx.beginPath();
  if (t.shape === 'circle') ctx.arc(t.x, t.y, L, 0, Math.PI * 2);
  else if (t.shape === 'cube') ctx.rect(Math.min(t.x, t.x + t.dx * L), Math.min(t.y, t.y + t.dy * L), L, L);
  else if (t.shape === 'line'){
    const ux = Math.cos(a), uy = Math.sin(a), nx = -uy * g / 2, ny = ux * g / 2;
    ctx.moveTo(t.x + nx, t.y + ny); ctx.lineTo(t.x + ux * L + nx, t.y + uy * L + ny); ctx.lineTo(t.x + ux * L - nx, t.y + uy * L - ny); ctx.lineTo(t.x - nx, t.y - ny); ctx.closePath();
  } else {
    const r = L / Math.cos(CONE_HALF);
    ctx.moveTo(t.x, t.y); ctx.lineTo(t.x + Math.cos(a - CONE_HALF) * r, t.y + Math.sin(a - CONE_HALF) * r);
    ctx.lineTo(t.x + Math.cos(a + CONE_HALF) * r, t.y + Math.sin(a + CONE_HALF) * r); ctx.closePath();
  }
}
function drawTemplate(t, m, g, preview){
  const rgb = hexRgb(t.color || '#c9a227');
  ctx.save();
  ctx.fillStyle = 'rgba(' + rgb + ',' + (preview ? 0.38 : 0.28) + ')';
  tplCells(t, m).forEach(c => ctx.fillRect(c.x + 1, c.y + 1, g - 2, g - 2));
  tplOutline(t, g);
  ctx.fillStyle = 'rgba(' + rgb + ',0.10)'; ctx.fill();
  ctx.strokeStyle = 'rgba(' + rgb + ',0.95)'; ctx.lineWidth = 2.5 / S.cam.s;
  if (preview) ctx.setLineDash([8 / S.cam.s, 5 / S.cam.s]);
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(' + rgb + ',1)'; ctx.beginPath(); ctx.arc(t.x, t.y, 5 / S.cam.s, 0, Math.PI * 2); ctx.fill();
  if (!preview){
    const lbl = t.len + ' ft' + (t.name ? ' · ' + t.name : '');
    const c = tplCenter(t, g);
    ctx.font = '600 ' + (12 / S.cam.s) + 'px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(lbl).width;
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(c.x - w / 2 - 4 / S.cam.s, c.y - 8 / S.cam.s, w + 8 / S.cam.s, 16 / S.cam.s);
    ctx.fillStyle = '#fff'; ctx.fillText(lbl, c.x, c.y);
  }
  ctx.restore();
}
function tplCenter(t, g){
  const L = t.len / 5 * g, a = t.angle || 0;
  if (t.shape === 'circle') return { x: t.x, y: t.y + Math.min(L * 0.5, g) };
  if (t.shape === 'cube') return { x: t.x + t.dx * L / 2, y: t.y + t.dy * L / 2 };
  const k = t.shape === 'cone' ? 0.62 : 0.5;
  return { x: t.x + Math.cos(a) * L * k, y: t.y + Math.sin(a) * L * k };
}
function drawTemplates(m, g){
  mapTemplates(m).forEach(t => drawTemplate(t, m, g, false));
  if (S.tplDraft && S.tplDraft.moved) drawTemplate(Object.assign(tplFromDraft(m, S.tplDraft), { color: myColor() }), m, g, true);
}
function tplDown(p){
  const m = activeMap();
  const o = gridVertex(m, p);   // las áreas nacen en una intersección de la rejilla
  S.tplDraft = { shape: S.tplShape, x: o.x, y: o.y, ex: p.x, ey: p.y, px: p.x, py: p.y, moved: false };
}
function tplMove(p, sx, sy){
  const d = S.tplDraft, m = activeMap(); if (!d || !m) return;
  d.ex = p.x; d.ey = p.y;
  if (!d.moved && Math.hypot(p.x - d.px, p.y - d.py) > gridOf(m) * 0.35) d.moved = true;
  if (d.moved){
    const t = tplFromDraft(m, d), lbl = $('#distLabel');
    lbl.style.display = 'block'; lbl.style.left = (sx + 14) + 'px'; lbl.style.top = (sy - 26) + 'px';
    lbl.textContent = TPL_NAMES[t.shape] + ' · ' + t.len + ' ft';
  }
  needsDraw();
}
async function tplUp(ok){
  const d = S.tplDraft, m = activeMap(); S.tplDraft = null;
  $('#distLabel').style.display = 'none';
  if (!d || !m || !ok){ needsDraw(); return; }
  const g = gridOf(m);
  if (!d.moved){
    const hit = mapTemplates(m).filter(canEditTpl).reverse().find(t => tplContains(t, d.px, d.py, g));
    if (hit){ DB.doc('templates/' + hit.id).delete().then(() => toast('Plantilla borrada')).catch(err => toast(err.message, true)); }
    else toast('Arrastra desde el origen para crear la plantilla');
    needsDraw(); return;
  }
  const t = Object.assign(tplFromDraft(m, d), { gameId: S.gameId, mapId: m.id, uid: S.uid, name: myName(), color: myColor(), ts: Date.now() });
  needsDraw();
  try { await DB.doc('templates/' + uuid()).set(t); }
  catch(err){ toast('No se pudo crear la plantilla: ' + (err.message || err), true); }
}

/* ============ música y ambiente sincronizados ============ */
const AUD = { els: {}, blocked: false, vol: lsGet('vtt_vol') == null ? 0.8 : clamp(+lsGet('vtt_vol') || 0, 0, 1), muted: !!lsGet('vtt_mute'), upKind: 'music' };
function audioState(){ const a = (gameDoc() || {}).audio || {}; return { tracks: a.tracks || [], play: a.play || {} }; }
function audioOn(){ return !!S.gameId && !S.projector; }
function syncAudio(){
  const st = audioState(), play = audioOn() ? st.play : {};
  const tracks = {}; st.tracks.forEach(t => { tracks[t.id] = t; });
  Object.keys(AUD.els).forEach(id => {
    if (!play[id] || !tracks[id]){ const a = AUD.els[id]; a.pause(); a.removeAttribute('src'); a.load(); delete AUD.els[id]; }
  });
  Object.keys(play).forEach(id => {
    const tr = tracks[id], pl = play[id]; if (!tr) return;
    let a = AUD.els[id];
    if (!a){
      a = new Audio(); a.preload = 'auto'; a.loop = tr.loop !== false; a.src = tr.url; a._at = null;
      a.addEventListener('loadedmetadata', () => seekAudio(a));
      a.addEventListener('error', () => toast('No se pudo cargar «' + tr.name + '»', true));
      AUD.els[id] = a;
    }
    a.volume = AUD.muted ? 0 : clamp((pl.vol == null ? tr.vol : pl.vol) * AUD.vol, 0, 1);
    if (a._at !== pl.at){ a._at = pl.at; a._done = false; seekAudio(a); }
    if (a.paused && !a._done) a.play().then(() => setAudioBlocked(false)).catch(e => { if (e && e.name === 'NotAllowedError') setAudioBlocked(true); });
  });
  updateAudioBtn();
  // no repintar el panel mientras el DM arrastra un deslizador de volumen
  const ae = document.activeElement;
  if (S.tab === 'audio' && !(ae && ae.type === 'range' && ae.closest && ae.closest('#panel'))) renderPanel();
}
function seekAudio(a){
  if (!a._at || !Number.isFinite(a.duration) || !a.duration) return;
  let t = Math.max(0, (Date.now() - a._at) / 1000);
  if (a.loop) t = t % a.duration;
  else if (t >= a.duration){ a._done = true; a.pause(); return; }
  if (Math.abs(a.currentTime - t) > 1.5){ try { a.currentTime = t; } catch(e){} }
}
function setAudioBlocked(b){
  if (AUD.blocked === b) return;
  AUD.blocked = b; updateAudioBtn();
  if (b) toast('🔈 Toca «Activar sonido» para oír la música de la partida');
}
function updateAudioBtn(){
  const btn = $('#btnAudio'), playing = audioOn() && Object.keys(audioState().play).length > 0;
  btn.style.display = playing ? '' : 'none';
  btn.classList.toggle('blocked', AUD.blocked);
  btn.textContent = AUD.blocked ? '🔈 Activar sonido' : (AUD.muted ? '🔇' : '🔊');
  btn.title = AUD.blocked ? 'El navegador necesita un toque para reproducir sonido' : (AUD.muted ? 'Activar el sonido' : 'Silenciar (solo en este dispositivo)');
}
function unlockAudio(){ Object.values(AUD.els).forEach(a => { if (!a._done) a.play().then(() => setAudioBlocked(false)).catch(() => {}); }); setAudioBlocked(false); syncAudio(); }
$('#btnAudio').onclick = () => {
  if (AUD.blocked){ unlockAudio(); return; }
  AUD.muted = !AUD.muted; lsSet('vtt_mute', AUD.muted ? 1 : null); syncAudio();
};
// Primer toque en cualquier sitio: desbloquea el audio si estaba bloqueado
document.addEventListener('pointerdown', () => { if (AUD.blocked) unlockAudio(); }, true);
function saveAudio(tracks, play){
  const audio = { tracks, play };
  if (S.localMode || !SB){ saveGame({ audio }); return; }
  const g = gameDoc(); if (g) g.audio = audio;   // respuesta inmediata en este dispositivo
  syncAudio();
  // en el servidor solo se toca data.audio: no pisa la ronda ni el combate que estén cambiando los jugadores
  rpc('set_game_audio', { gid: S.gameId, audio }).catch(e => toast('Sonido: ' + e.message, true));
}
function audioPlay(id){
  const st = audioState(), tr = st.tracks.find(t => t.id === id); if (!tr) return;
  const play = Object.assign({}, st.play);
  if (tr.kind === 'music') st.tracks.forEach(t => { if (t.kind === 'music') delete play[t.id]; });   // una sola música a la vez
  play[id] = { at: Date.now(), vol: tr.vol };
  saveAudio(st.tracks, play);
}
function audioStop(id){ const st = audioState(), play = Object.assign({}, st.play); delete play[id]; saveAudio(st.tracks, play); }
function renderAudioPanel(p){
  const st = audioState(), playing = st.play;
  const nowNames = st.tracks.filter(t => playing[t.id]).map(t => (t.kind === 'amb' ? '🌲 ' : '🎵 ') + t.name);
  let html = '<div class="section-title">Tu volumen (solo en este dispositivo)</div><div class="card">' +
    '<div class="row between"><label>' + (AUD.muted ? '🔇 Silenciado' : '🔊 Volumen') + '</label><span class="row"><input type="range" id="audVol" min="0" max="100" value="' + Math.round(AUD.vol * 100) + '" style="width:130px"><button class="small" id="audMute">' + (AUD.muted ? 'Activar' : 'Silenciar') + '</button></span></div>' +
    '<div class="mini" style="margin-top:6px">' + (nowNames.length ? 'Ahora suena: ' + nowNames.map(esc).join(' · ') : 'Ahora no suena nada.') + '</div>' +
    (AUD.blocked ? '<button class="primary" id="audUnlock" style="width:100%; margin-top:8px">🔈 Activar sonido</button>' : '') + '</div>';
  if (!S.isDM){ p.innerHTML = html + '<div class="muted">El DM elige la música y el ambiente; la oyes en tu dispositivo a la vez que el resto del grupo.</div>'; bindAudioCommon(); return; }
  html += '<div class="section-title">Añadir pistas</div><div class="card">' +
    '<div class="row"><select id="audKind"><option value="music"' + (AUD.upKind === 'music' ? ' selected' : '') + '>🎵 Música (una a la vez)</option><option value="amb"' + (AUD.upKind === 'amb' ? ' selected' : '') + '>🌲 Ambiente (se pueden mezclar)</option></select>' +
    '<button class="primary grow" id="audAdd">📤 Subir audio</button></div>' +
    '<div class="mini" style="margin-top:6px">MP3, OGG, WAV o M4A, hasta 50 MB. Suenan en bucle y todos los oyen sincronizados.</div>' +
    '<input type="file" id="audFile" accept="audio/*,.mp3,.ogg,.wav,.m4a" multiple style="display:none"><div class="mini" id="audProg"></div></div>';
  [['music', '🎵 Música'], ['amb', '🌲 Ambiente']].forEach(([k, lbl]) => {
    const list = st.tracks.filter(t => t.kind === k);
    html += '<div class="section-title">' + lbl + ' (' + list.length + ')</div>';
    if (!list.length) html += '<div class="muted" style="margin-bottom:8px">' + (k === 'music' ? 'Sin música todavía.' : 'Sin sonidos de ambiente (lluvia, taberna, cueva…).') + '</div>';
    list.forEach(t => {
      const on = !!playing[t.id];
      html += '<div class="trk' + (on ? ' on' : '') + '"><button class="small aud-toggle" data-id="' + esc(t.id) + '">' + (on ? '⏸' : '▶') + '</button>' +
        '<span class="nm" title="' + esc(t.name) + '">' + esc(t.name) + '</span>' +
        '<input type="range" class="aud-vol" data-id="' + esc(t.id) + '" min="0" max="100" value="' + Math.round((t.vol == null ? 0.7 : t.vol) * 100) + '" title="Volumen para todos">' +
        '<button class="small aud-del" data-id="' + esc(t.id) + '" title="Quitar de la lista">🗑</button></div>';
    });
  });
  if (Object.keys(playing).length) html += '<button class="danger" id="audStopAll" style="width:100%; margin-top:6px">⏹ Parar todo</button>';
  p.innerHTML = html;
  bindAudioCommon();
  $('#audKind').onchange = e => { AUD.upKind = e.target.value; };
  $('#audAdd').onclick = () => $('#audFile').click();
  $('#audFile').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    const kind = $('#audKind').value, added = [];
    for (const f of files){
      if (!/^audio\//.test(f.type) && !/\.(mp3|ogg|wav|m4a)$/i.test(f.name)){ toast('«' + f.name + '» no es un audio', true); continue; }
      if (f.size > 50 * 1048576){ toast('«' + f.name + '» pesa más de 50 MB', true); continue; }
      const prog = $('#audProg'); if (prog) prog.textContent = 'Subiendo «' + f.name + '»…';
      try {
        const blob = f.type ? f : new Blob([f], { type: 'audio/mpeg' });
        const url = S.localMode ? URL.createObjectURL(blob) : (await uploadAsset(blob)).url;
        added.push({ id: uuid(), name: f.name.replace(/\.[^.]+$/, '').slice(0, 80), url, kind, vol: 0.7, loop: true });
      } catch(err){ toast('No se pudo subir «' + f.name + '»: ' + (err.message || err), true); }
    }
    if (added.length){ const st2 = audioState(); saveAudio(st2.tracks.concat(added), st2.play); toast(added.length + ' pista(s) añadidas'); }
    const prog = $('#audProg'); if (prog) prog.textContent = '';
  };
  $$('.aud-toggle').forEach(b => b.onclick = () => { if (audioState().play[b.dataset.id]) audioStop(b.dataset.id); else audioPlay(b.dataset.id); });
  $$('.aud-vol').forEach(r => r.onchange = () => {
    const st2 = audioState(), v = clamp((parseInt(r.value) || 0) / 100, 0, 1);
    const tracks = st2.tracks.map(t => t.id === r.dataset.id ? Object.assign({}, t, { vol: v }) : t);
    const play = Object.assign({}, st2.play); if (play[r.dataset.id]) play[r.dataset.id] = Object.assign({}, play[r.dataset.id], { vol: v });
    saveAudio(tracks, play);
  });
  $$('.aud-del').forEach(b => b.onclick = () => armConfirm(b, () => {
    const st2 = audioState(), play = Object.assign({}, st2.play); delete play[b.dataset.id];
    saveAudio(st2.tracks.filter(t => t.id !== b.dataset.id), play);
  }));
  const sa = $('#audStopAll'); if (sa) sa.onclick = () => saveAudio(audioState().tracks, {});
}
function bindAudioCommon(){
  $('#audVol').oninput = e => { AUD.vol = clamp((parseInt(e.target.value) || 0) / 100, 0, 1); lsSet('vtt_vol', AUD.vol); syncAudioVolumes(); };
  $('#audMute').onclick = () => { AUD.muted = !AUD.muted; lsSet('vtt_mute', AUD.muted ? 1 : null); syncAudio(); renderPanel(); };
  const u = $('#audUnlock'); if (u) u.onclick = () => { unlockAudio(); renderPanel(); };
}
function syncAudioVolumes(){
  const st = audioState(); const tracks = {}; st.tracks.forEach(t => { tracks[t.id] = t; });
  Object.entries(AUD.els).forEach(([id, a]) => {
    const tr = tracks[id], pl = st.play[id]; if (!tr || !pl) return;
    a.volume = AUD.muted ? 0 : clamp((pl.vol == null ? tr.vol : pl.vol) * AUD.vol, 0, 1);
  });
}
// cada 30 s, corrige la deriva respecto al resto del grupo
setInterval(() => Object.values(AUD.els).forEach(a => { if (!a.paused) seekAudio(a); }), 30000);

/* ============ ganchos de pruebas (solo en localhost) ============ */
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
  const px = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++; return n; };
  Object.assign(window, {
    __cam: () => ({ x: S.cam.x, y: S.cam.y, s: S.cam.s }),
    __tokVisible: id => { const t = S.tokens[id]; if (!t) return null; if (S.fogDirty) recomputeFog(); return tokenVisibleToPlayers(t); },
    __seen: (x, y) => { if (S.fogDirty) recomputeFog(); return pointSeen(x, y); },
    __rulers: () => Object.values(S.rulers).map(r => ({ name: r.name, n: r.pts.length })),
    __tpls: () => { const m = activeMap(); return m ? mapTemplates(m).length : -1; },
    __tplCells: i => { const m = activeMap(); return tplCells(mapTemplates(m)[i], m).length; },
    __expPixels: () => { const m = activeMap(); if (!m) return -1; if (S.fogDirty) recomputeFog(); return px(getExplored(m)); },
    __sbClient: () => SB,
    __recompute: () => recomputeFog(),
    __reachCells: () => (S.reach || []).map(c => ({ x: c.x, y: c.y })),
    __resetLightCache: () => { lightCache = { key: null, list: [] }; },
    __seenPixels: () => { if (S.fogDirty) recomputeFog(); const m = activeMap(); const ex = getExplored(m); const c = document.createElement('canvas'); c.width = ex.width; c.height = ex.height; c.getContext('2d').drawImage(seenCanvas, 0, 0, c.width, c.height); return px(c); }
  });
}
/* ============ inicial ============ */
resizeCanvas();
renderPanel();
