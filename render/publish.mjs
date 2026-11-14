// Publie out/video.mp4 directement via les API officielles (gratuites) :
//   YouTube Shorts (YouTube Data API v3), Instagram Reels et Facebook Reels (API Graph de Meta).
// Chaque plateforme n'est utilisée que si ses secrets sont présents ; une plateforme en échec
// n'empêche pas les autres. Le job échoue à la fin si au moins une a échoué (→ e-mail GitHub).
import { readFile, writeFile, stat } from 'node:fs/promises';
import { buildCaption } from './caption.mjs';

const cfg = JSON.parse(await readFile('config.json', 'utf8'));
const meta = JSON.parse(await readFile('out/video.json', 'utf8'));
const cap = buildCaption(meta, cfg);
const VIDEO = 'out/video.mp4';
const env = process.env;
const DRY = env.DRY_RUN === '1';
const G = 'https://graph.facebook.com/v23.0';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function req(url, opts = {}) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok || j.error) throw new Error(`${r.status} ${url.split('?')[0]} : ${t.slice(0, 600)}`);
  return { j, r };
}
const form = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined));
const retry = async (fn, n = 3) => { let e; for (let i = 1; i <= n; i++) { try { return await fn(); } catch (x) { e = x; console.error(`   essai ${i} raté : ${x.message}`); await sleep(30_000 * i); } } throw e; };

// ---------- YouTube Shorts ----------
async function youtube() {
  const { j: tok } = await req('https://oauth2.googleapis.com/token', { method: 'POST', body: form({
    client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, refresh_token: env.YT_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  const bytes = await readFile(VIDEO);
  const metaBody = JSON.stringify({
    snippet: { title: cap.youtubeTitle, description: cap.text, categoryId: '10', tags: ['piano', 'chords', 'chord progression', 'relaxing music', 'calm', 'pixel art', 'music theory', 'lofi', 'sleep music', 'study music'] },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
  });
  const { r } = await req('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', body: metaBody,
    headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(bytes.length) } });
  const { j } = await req(r.headers.get('location'), { method: 'PUT', body: bytes, headers: { 'Content-Type': 'video/mp4' } });
  return `https://youtube.com/shorts/${j.id}`;
}

// ---------- Instagram Reels ----------
async function instagram() {
  const T = env.META_PAGE_TOKEN, IG = env.META_IG_USER_ID, size = (await stat(VIDEO)).size;
  const { j: c } = await req(`${G}/${IG}/media`, { method: 'POST', body: form({
    media_type: 'REELS', upload_type: 'resumable', caption: cap.text, share_to_feed: 'true', access_token: T }) });
  await req(c.uri || `https://rupload.facebook.com/ig-api-upload/v23.0/${c.id}`, { method: 'POST', body: await readFile(VIDEO),
    headers: { Authorization: `OAuth ${T}`, offset: '0', file_size: String(size) } });
  for (let i = 0; i < 60; i++) {                                   // traitement côté Instagram (≤ 10 min)
    await sleep(10_000);
    const { j: s } = await req(`${G}/${c.id}?fields=status_code,status&access_token=${T}`);
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error('Instagram a refusé la vidéo : ' + JSON.stringify(s));
  }
  const { j: p } = await req(`${G}/${IG}/media_publish`, { method: 'POST', body: form({ creation_id: c.id, access_token: T }) });
  const { j: m } = await req(`${G}/${p.id}?fields=permalink&access_token=${T}`).catch(() => ({ j: {} }));
  return m.permalink || `media ${p.id}`;
}

// ---------- Facebook Reels ----------
async function facebook() {
  const T = env.META_PAGE_TOKEN, PAGE = env.META_PAGE_ID, size = (await stat(VIDEO)).size;
  const { j: s } = await req(`${G}/${PAGE}/video_reels`, { method: 'POST', body: form({ upload_phase: 'start', access_token: T }) });
  await req(s.upload_url || `https://rupload.facebook.com/video-upload/v23.0/${s.video_id}`, { method: 'POST', body: await readFile(VIDEO),
    headers: { Authorization: `OAuth ${T}`, offset: '0', file_size: String(size) } });
  await req(`${G}/${PAGE}/video_reels`, { method: 'POST', body: form({
    upload_phase: 'finish', video_id: s.video_id, video_state: 'PUBLISHED', description: cap.text, access_token: T }) });
  return `https://www.facebook.com/reel/${s.video_id}`;
}

const PLATFORMS = {
  youtube:   { fn: youtube,   needs: ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN'] },
  instagram: { fn: instagram, needs: ['META_PAGE_TOKEN', 'META_IG_USER_ID'] },
  facebook:  { fn: facebook,  needs: ['META_PAGE_TOKEN', 'META_PAGE_ID'] }
};

console.log('— Légende —\n' + cap.text + '\n————');
const wanted = cfg.plateformes.filter(p => PLATFORMS[p]);
const results = {}, failed = [];
for (const p of wanted) {
  const missing = PLATFORMS[p].needs.filter(k => !env[k]);
  if (missing.length) { console.log(`⏭  ${p} : pas configuré (${missing.join(', ')})`); continue; }
  if (DRY) { console.log(`🧪 ${p} : prêt (répétition, rien n’est publié)`); continue; }
  console.log(`▶ ${p}…`);
  try { results[p] = await retry(PLATFORMS[p].fn); console.log(`✓ ${p} : ${results[p]}`); }
  catch (e) { failed.push(p); console.error(`✗ ${p} : ${e.message}`); }
}

if (Object.keys(results).length) {
  const hist = JSON.parse(await readFile('state/historique.json', 'utf8').catch(() => '[]'));
  hist.push({ date: meta.date, seed: meta.seed, signature: meta.signature, cle: meta.key,
    accords: meta.chords.map(c => c.name).join(' '), liens: results, echecs: failed });
  await writeFile('state/historique.json', JSON.stringify(hist, null, 1));
}
if (failed.length) { console.error(`Échec sur : ${failed.join(', ')}`); process.exit(1); }
