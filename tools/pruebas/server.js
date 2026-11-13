// Servidor de pruebas que imita lo que la app usa de Supabase:
// auth anónima, REST (PostgREST) sobre Postgres real con RLS, RPC, storage y realtime (v2).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool, Client } = require('pg');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 54321;
const PG = { host: '/tmp/pg', port: 5433, user: 'postgres', database: 'vtt' };
const STORE = '/tmp/mockstore';
fs.mkdirSync(STORE, { recursive: true });
const pool = new Pool(PG);
const log = (...a) => { if (process.env.DEBUG) console.log(...a); };

/* ---------- utilidades ---------- */
const b64u = b => Buffer.from(b).toString('base64url');
function makeJwt(uid){
  const now = Math.floor(Date.now() / 1000);
  return b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
    b64u(JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600 * 24, iat: now, is_anonymous: true, session_id: crypto.randomUUID() })) + '.sig';
}
function uidFromReq(req){
  const h = req.headers.authorization || '';
  const tok = h.replace(/^Bearer\s+/i, '');
  const parts = tok.split('.');
  if (parts.length !== 3) return null;
  try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); return p.sub || null; } catch(e){ return null; }
}
function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Type');
}
function send(res, code, obj, headers){
  cors(res);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {}));
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}
function readBody(req){ return new Promise(r => { const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => r(Buffer.concat(ch))); }); }
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error('identificador no válido: ' + s); return '"' + s + '"'; };
function userObj(u){ return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email || '', is_anonymous: true, app_metadata: { provider: 'anonymous', providers: [] }, user_metadata: u.raw_user_meta_data || {}, identities: [], created_at: u.created_at || new Date().toISOString() }; }

// Ejecuta como el usuario (rol authenticated + claims), dentro de una transacción
async function asUser(uid, fn){
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)",
      [uid || '', uid ? 'authenticated' : 'anon', JSON.stringify({ sub: uid, role: uid ? 'authenticated' : 'anon' })]);
    await c.query('set local role ' + (uid ? 'authenticated' : 'anon'));
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch(e){ try { await c.query('rollback'); } catch(_){} throw e; }
  finally { c.release(); }
}
function pgErr(res, e, code){
  log('ERR', e.message);
  send(res, code || (e.code === '42501' ? 403 : 400), { code: e.code || 'PGRST', message: e.message, details: null, hint: null });
}

/* ---------- PostgREST mínimo ---------- */
const TABLE_COLS = {};
async function tableCols(t){
  if (TABLE_COLS[t]) return TABLE_COLS[t];
  const r = await pool.query("select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1", [t]);
  TABLE_COLS[t] = Object.fromEntries(r.rows.map(x => [x.column_name, x.data_type]));
  return TABLE_COLS[t];
}
function parseFilters(q, params){
  const where = [];
  for (const [k, v] of q){
    if (['select', 'on_conflict', 'order', 'limit', 'columns'].includes(k)) continue;
    const m = /^(eq|neq|in|is)\.(.*)$/.exec(v);
    if (!m) throw new Error('filtro no soportado: ' + k + '=' + v);
    if (m[1] === 'eq'){ params.push(m[2]); where.push(ident(k) + '::text = $' + params.length); }
    else if (m[1] === 'neq'){ params.push(m[2]); where.push(ident(k) + '::text <> $' + params.length); }
    else if (m[1] === 'is') where.push(ident(k) + (m[2] === 'null' ? ' is null' : ' is not null'));
    else { const vals = m[2].replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')); params.push(vals); where.push(ident(k) + '::text = any($' + params.length + ')'); }
  }
  return where;
}
function selCols(q){ const s = q.get('select'); return !s || s === '*' ? '*' : s.split(',').map(x => ident(x.trim())).join(','); }
async function handleRest(req, res, t, q){
  const uid = uidFromReq(req);
  const prefer = req.headers.prefer || '';
  const wantRep = /return=representation/.test(prefer);
  const single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
  try {
    if (t.startsWith('rpc/')) return handleRpc(req, res, t.slice(4), uid);
    const cols = await tableCols(t);
    if (!Object.keys(cols).length) return send(res, 404, { message: 'tabla ' + t + ' no existe' });
    const params = [];
    if (req.method === 'GET' || req.method === 'HEAD'){
      const where = parseFilters(q, params);
      let sql = 'select ' + selCols(q) + ' from public.' + ident(t) + (where.length ? ' where ' + where.join(' and ') : '');
      if (q.get('limit')) sql += ' limit ' + (+q.get('limit'));
      const r = await asUser(uid, c => c.query(sql, params));
      if (single){ if (r.rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }); return send(res, 200, r.rows[0]); }
      return send(res, 200, r.rows);
    }
    if (req.method === 'POST'){
      const body = JSON.parse((await readBody(req)).toString() || '[]');
      const rows = Array.isArray(body) ? body : [body];
      const merge = /resolution=merge-duplicates/.test(prefer);
      const conflict = (q.get('on_conflict') || '').split(',').filter(Boolean);
      const out = await asUser(uid, async c => {
        const res2 = [];
        for (const row of rows){
          const keys = Object.keys(row).filter(k => cols[k]);
          const ps = keys.map(k => (cols[k] === 'jsonb' ? JSON.stringify(row[k]) : row[k]));
          let sql = 'insert into public.' + ident(t) + ' (' + keys.map(ident).join(',') + ') values (' + keys.map((k, i) => '$' + (i + 1)).join(',') + ')';
          if (merge){
            const pk = conflict.length ? conflict : (cols.id ? ['id'] : keys.slice(0, 2));
            const upd = keys.filter(k => !pk.includes(k));
            sql += ' on conflict (' + pk.map(ident).join(',') + ') do ' + (upd.length ? 'update set ' + upd.map(k => ident(k) + '=excluded.' + ident(k)).join(',') : 'nothing');
          }
          sql += ' returning *';
          const r = await c.query(sql, ps);
          res2.push(...r.rows);
        }
        return res2;
      });
      return send(res, 201, wantRep ? (single ? out[0] : out) : undefined);
    }
    if (req.method === 'PATCH'){
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const keys = Object.keys(body).filter(k => cols[k]);
      keys.forEach(k => params.push(cols[k] === 'jsonb' ? JSON.stringify(body[k]) : body[k]));
      const where = parseFilters(q, params);
      const sql = 'update public.' + ident(t) + ' set ' + keys.map((k, i) => ident(k) + '=$' + (i + 1)).join(',') + (where.length ? ' where ' + where.join(' and ') : '') + ' returning ' + selCols(q);
      const r = await asUser(uid, c => c.query(sql, params));
      return send(res, 200, wantRep || q.get('select') ? r.rows : undefined);
    }
    if (req.method === 'DELETE'){
      const where = parseFilters(q, params);
      if (!where.length) throw new Error('DELETE sin filtro');
      const r = await asUser(uid, c => c.query('delete from public.' + ident(t) + ' where ' + where.join(' and ') + ' returning *', params));
      return send(res, 200, wantRep ? r.rows : undefined);
    }
    send(res, 405, { message: 'método' });
  } catch(e){ pgErr(res, e); }
}
async function handleRpc(req, res, fn, uid){
  try {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const keys = Object.keys(body);
    const ps = keys.map(k => (body[k] !== null && typeof body[k] === 'object') ? JSON.stringify(body[k]) : body[k]);
    const call = 'public.' + ident(fn) + '(' + keys.map((k, i) => ident(k) + ' => $' + (i + 1)).join(',') + ')';
    const setof = (await pool.query("select bool_or(proretset) s from pg_proc where pronamespace='public'::regnamespace and proname=$1", [fn])).rows[0].s;
    if (setof){ const r = await asUser(uid, c => c.query('select * from ' + call, ps)); return send(res, 200, r.rows); }
    const r = await asUser(uid, c => c.query('select ' + call + ' as r', ps));
    send(res, 200, r.rows[0] ? r.rows[0].r : null);
  } catch(e){ pgErr(res, e); }
}

/* ---------- storage ---------- */
async function handleStorage(req, res, rest){
  const uid = uidFromReq(req);
  let m = /^object\/public\/([^/]+)\/(.+)$/.exec(rest);
  if (m && req.method === 'GET'){
    const f = path.join(STORE, m[1], decodeURIComponent(m[2]));
    if (!f.startsWith(STORE) || !fs.existsSync(f)) return send(res, 404, { message: 'no existe' });
    const meta = JSON.parse(fs.readFileSync(f + '.meta'));
    cors(res); res.writeHead(200, { 'Content-Type': meta.type, 'Accept-Ranges': 'bytes', 'Content-Length': fs.statSync(f).size });
    return fs.createReadStream(f).pipe(res);
  }
  m = /^object\/([^/]+)\/(.+)$/.exec(rest);
  if (m && (req.method === 'POST' || req.method === 'PUT')){
    const bucket = m[1], name = decodeURIComponent(m[2]);
    let body = await readBody(req);
    let type = (req.headers['content-type'] || 'application/octet-stream').split(';')[0];
    const bm = /multipart\/form-data;\s*boundary=(.+)$/i.exec(req.headers['content-type'] || '');
    if (bm){
      // storage-js manda los Blob como FormData: nos quedamos con la parte que lleva el archivo
      const boundary = Buffer.from('--' + bm[1].replace(/^"|"$/g, ''));
      let i = body.indexOf(boundary), file = null;
      while (i >= 0){
        const j = body.indexOf(boundary, i + boundary.length); if (j < 0) break;
        const part = body.slice(i + boundary.length + 2, j - 2);
        const h = part.indexOf('\r\n\r\n'); const head = part.slice(0, h).toString(); const data = part.slice(h + 4);
        if (/filename=|content-type:/i.test(head) && !/name="cacheControl"/.test(head)){ file = data; const ct = /content-type:\s*([^\r\n]+)/i.exec(head); if (ct) type = ct[1].trim(); }
        i = j;
      }
      if (file) body = file;
    }
    try {
      const b = (await pool.query('select * from storage.buckets where id=$1', [bucket])).rows[0];
      if (!b) return send(res, 404, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
      if (b.allowed_mime_types && !b.allowed_mime_types.includes(type)) return send(res, 400, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type ' + type + ' is not supported' });
      if (b.file_size_limit && body.length > b.file_size_limit) return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      await asUser(uid, c => c.query('insert into storage.objects (bucket_id, name, owner, metadata) values ($1,$2,$3,$4)', [bucket, name, uid, JSON.stringify({ mimetype: type, size: body.length })]));
      const f = path.join(STORE, bucket, name);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body); fs.writeFileSync(f + '.meta', JSON.stringify({ type }));
      return send(res, 200, { Key: bucket + '/' + name, Id: crypto.randomUUID() });
    } catch(e){ return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy: ' + e.message }); }
  }
  send(res, 404, { message: 'storage: ruta no soportada ' + rest });
}

/* ---------- auth ---------- */
async function handleAuth(req, res, rest, q){
  if (rest === 'signup' && req.method === 'POST'){
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const id = crypto.randomUUID();
    await pool.query('insert into auth.users (id, raw_user_meta_data) values ($1,$2)', [id, JSON.stringify(body.data || {})]);
    const u = (await pool.query('select * from auth.users where id=$1', [id])).rows[0];
    const now = Math.floor(Date.now() / 1000);
    return send(res, 200, { access_token: makeJwt(id), token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, refresh_token: 'r-' + id, user: userObj(u) });
  }
  if (rest === 'user' && req.method === 'GET'){
    const uid = uidFromReq(req);
    const u = uid && (await pool.query('select * from auth.users where id=$1', [uid])).rows[0];
    return u ? send(res, 200, userObj(u)) : send(res, 401, { message: 'invalid JWT', code: 401 });
  }
  if (rest === 'token' && q.get('grant_type') === 'refresh_token'){
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const id = String(body.refresh_token || '').replace(/^r-/, '');
    const u = (await pool.query('select * from auth.users where id=$1', [id])).rows[0];
    if (!u) return send(res, 400, { error: 'invalid_grant', message: 'Invalid Refresh Token' });
    const now = Math.floor(Date.now() / 1000);
    return send(res, 200, { access_token: makeJwt(id), token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, refresh_token: 'r-' + id, user: userObj(u) });
  }
  if (rest === 'logout') return send(res, 204);
  if (rest === 'settings') return send(res, 200, { external: { anonymous_users: true, email: true, google: false } });
  send(res, 404, { message: 'auth: no soportado ' + rest });
}

/* ---------- realtime (protocolo v2) ---------- */
const clients = new Set();   // { ws, uid, topics: Map(topic -> { joinRef, pg: [{id, event, table}], presenceKey, self }) }
const presence = new Map();  // topic -> Map(key -> [metas])
function wsSend(cl, joinRef, ref, topic, event, payload){ try { cl.ws.send(JSON.stringify([joinRef, ref, topic, event, payload])); } catch(e){} }
function presenceState(topic){ const m = presence.get(topic) || new Map(); const o = {}; m.forEach((metas, k) => { o[k] = { metas }; }); return o; }
function presenceDiff(topic, joins, leaves){
  clients.forEach(cl => { const sub = cl.topics.get(topic); if (sub) wsSend(cl, sub.joinRef, null, topic, 'presence_diff', { joins, leaves }); });
}
function dropPresence(cl, topic){
  const sub = cl.topics.get(topic); if (!sub || !sub.presenceRef) return;
  const m = presence.get(topic); if (!m) return;
  const metas = (m.get(sub.presenceKey) || []);
  const mine = metas.filter(x => x.phx_ref === sub.presenceRef);
  const rest = metas.filter(x => x.phx_ref !== sub.presenceRef);
  if (rest.length) m.set(sub.presenceKey, rest); else m.delete(sub.presenceKey);
  if (mine.length) presenceDiff(topic, {}, { [sub.presenceKey]: { metas: mine } });
  sub.presenceRef = null;
}
let pgSeq = 1;
function relay(sender, topic, payload){
  clients.forEach(cl => {
    const sub = cl.topics.get(topic); if (!sub) return;
    if (cl === sender && !sub.self) return;
    wsSend(cl, null, null, topic, 'broadcast', payload);
  });
}
function onMessage(cl, raw, isBinary){
  let joinRef, ref, topic, event, payload;
  if (isBinary){
    const buf = Buffer.from(raw);
    if (buf[0] !== 3) return;
    const [jl, rl, tl, el, ml, enc] = [buf[1], buf[2], buf[3], buf[4], buf[5], buf[6]];
    let o = 7;
    joinRef = buf.slice(o, o + jl).toString(); o += jl;
    ref = buf.slice(o, o + rl).toString(); o += rl;
    topic = buf.slice(o, o + tl).toString(); o += tl;
    const ev = buf.slice(o, o + el).toString(); o += el;
    o += ml;
    const body = buf.slice(o);
    payload = { type: 'broadcast', event: ev, payload: enc === 1 ? JSON.parse(body.toString() || '{}') : {} };
    event = 'broadcast';
  } else {
    [joinRef, ref, topic, event, payload] = JSON.parse(raw.toString());
  }
  log('WS <-', cl.uid, topic, event);
  if (topic === 'phoenix' && event === 'heartbeat') return wsSend(cl, null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} });
  if (event === 'phx_join'){
    const cfg = (payload && payload.config) || {};
    const pg = (cfg.postgres_changes || []).map(b => ({ id: pgSeq++, event: b.event, schema: b.schema, table: b.table, filter: b.filter }));
    cl.topics.set(topic, { joinRef, pg, self: !!(cfg.broadcast && cfg.broadcast.self), presenceKey: (cfg.presence && cfg.presence.key) || crypto.randomUUID(), presenceRef: null });
    wsSend(cl, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: pg.map(b => ({ id: b.id, event: b.event, schema: b.schema, table: b.table, filter: b.filter })) } });
    if (pg.length) wsSend(cl, joinRef, null, topic, 'system', { status: 'ok', message: 'Subscribed to PostgreSQL', extension: 'postgres_changes', channel: topic.replace(/^realtime:/, '') });
    setTimeout(() => wsSend(cl, joinRef, null, topic, 'presence_state', presenceState(topic)), 20);
    return;
  }
  if (event === 'phx_leave'){ dropPresence(cl, topic); cl.topics.delete(topic); return wsSend(cl, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }); }
  if (event === 'access_token') return;
  if (event === 'broadcast'){ relay(cl, topic, payload); if (ref) wsSend(cl, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }); return; }
  if (event === 'presence'){
    const sub = cl.topics.get(topic); if (!sub) return;
    if (payload.event === 'track'){
      dropPresence(cl, topic);
      const meta = Object.assign({}, payload.payload, { phx_ref: crypto.randomUUID().slice(0, 12) });
      sub.presenceRef = meta.phx_ref;
      if (!presence.has(topic)) presence.set(topic, new Map());
      const m = presence.get(topic); m.set(sub.presenceKey, (m.get(sub.presenceKey) || []).concat([meta]));
      presenceDiff(topic, { [sub.presenceKey]: { metas: [meta] } }, {});
    } else if (payload.event === 'untrack') dropPresence(cl, topic);
    if (ref) wsSend(cl, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
    return;
  }
  if (ref) wsSend(cl, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
}
// Cambios en la BD -> clientes suscritos que puedan VER la fila (RLS)
const lastSeen = new Map();  // `${uid}|${table}|${id}` -> visible
async function onDbChange(n){
  const { t, op, id } = n;
  const cols = [{ name: 'id', type: 'text' }, { name: 'data', type: 'jsonb' }, { name: 'updated_at', type: 'timestamptz' }];
  for (const cl of clients){
    for (const [topic, sub] of cl.topics){
      const bs = sub.pg.filter(b => b.table === t && (b.event === '*' || b.event === op));
      if (!bs.length) continue;
      let row = null;
      if (op !== 'DELETE'){
        try { row = (await asUser(cl.uid, c => c.query('select id, data, updated_at from public.' + ident(t) + ' where id=$1', [id]))).rows[0] || null; } catch(e){ row = null; }
      }
      const key = cl.uid + '|' + t + '|' + id;
      let type = op, record = row, old = { id };
      if (op !== 'DELETE' && !row){ if (lastSeen.get(key)) { type = 'DELETE'; } else continue; }   // dejó de verse
      if (type === 'DELETE' && op === 'DELETE' && lastSeen.get(key) === false) continue;
      lastSeen.set(key, type !== 'DELETE');
      const data = { schema: 'public', table: t, commit_timestamp: new Date().toISOString(), type, columns: cols, errors: null, record: type === 'DELETE' ? {} : record, old_record: old };
      wsSend(cl, sub.joinRef, null, topic, 'postgres_changes', { ids: bs.map(b => b.id), data });
    }
  }
}

/* ---------- arranque ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS'){ cors(res); res.writeHead(204); return res.end(); }
  log(req.method, u.pathname + u.search);
  const p = u.pathname;
  if (p.startsWith('/rest/v1/')) return handleRest(req, res, p.slice(9), u.searchParams);
  if (p.startsWith('/auth/v1/')) return handleAuth(req, res, p.slice(9), u.searchParams);
  if (p.startsWith('/storage/v1/')) return handleStorage(req, res, p.slice(12));
  if (p === '/realtime/v1/api/broadcast' && req.method === 'POST'){
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    (body.messages || []).forEach(m => relay(null, 'realtime:' + m.topic, { type: 'broadcast', event: m.event, payload: m.payload }));
    return send(res, 202, {});
  }
  send(res, 404, { message: 'no soportado ' + p });
});
const wss = new WebSocketServer({ server, path: '/realtime/v1/websocket' });
wss.on('connection', (ws, req) => {
  const cl = { ws, uid: null, topics: new Map() };
  clients.add(cl);
  ws.on('message', (raw, isBinary) => {
    try {
      if (!isBinary){ const a = JSON.parse(raw.toString()); const pl = a[4]; if (pl && pl.access_token){ const parts = String(pl.access_token).split('.'); try { cl.uid = JSON.parse(Buffer.from(parts[1], 'base64url').toString()).sub; } catch(e){} } }
      onMessage(cl, raw, isBinary);
    } catch(e){ console.error('ws', e.message); }
  });
  ws.on('close', () => { cl.topics.forEach((s, t) => dropPresence(cl, t)); clients.delete(cl); });
});
(async () => {
  const lc = new Client(PG); await lc.connect();
  await lc.query('listen chg');
  lc.on('notification', m => { try { onDbChange(JSON.parse(m.payload)); } catch(e){ console.error(e); } });
  server.listen(PORT, () => console.log('mock supabase en http://localhost:' + PORT));
})();
