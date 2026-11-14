// Publishes today's video (out/video.mp4, already online at VIDEO_URL) — 100 % free:
//   • YouTube Shorts : via a Make.com scenario (webhook → download → YouTube "Upload a video").
//   • Instagram Reels : directly via Meta's Graph API (system user token, never expires).
// Each platform runs only if its secrets exist; one failing platform doesn't block the other.
// The job fails at the end if any platform failed (→ GitHub e-mail).
//
// Env : VIDEO_URL, MAKE_WEBHOOK_URL, IG_TOKEN, IG_USER_ID, DRY_RUN=1
import { readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { buildCaption } from './caption.mjs';

const cfg = JSON.parse(await readFile('config.json', 'utf8'));
const meta = JSON.parse(await readFile('out/video.json', 'utf8'));
const cap = buildCaption(meta, cfg);
const env = process.env, DRY = env.DRY_RUN === '1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function req(url, opts = {}) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok || j.error) throw new Error(`${r.status} ${url.split('?')[0]} : ${t.slice(0, 600)}`);
  return j;
}
const retry = async (fn, n = 3) => { let e; for (let i = 1; i <= n; i++) { try { return await fn(); } catch (x) { e = x; console.error(`   attempt ${i} failed: ${x.message}`); if (i < n) await sleep(30_000 * i); } } throw e; };

// ---------- YouTube (through Make) ----------
async function youtube() {
  const body = { video_url: env.VIDEO_URL, title: cap.youtubeTitle, description: cap.text,
    tags: 'piano,chords,chord progression,relaxing music,calm,pixel art,music theory,lofi,sleep music,study music',
    date: meta.date, key: meta.key };
  const r = await fetch(env.MAKE_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Make ${r.status}: ${t.slice(0, 300)}`);
  return `sent to Make (${t.slice(0, 60) || 'Accepted'})`;
}

// ---------- Instagram Reels ----------
// Works with both token kinds Meta hands out:
//   • "EAA…"  (system user / Facebook login) → graph.facebook.com, never expires.
//   • "IGAA…" (Instagram login)              → graph.instagram.com, valid 60 days: renewed weekly
//     and stored encrypted in state/ig_token.enc (needs the IG_TOKEN_KEY secret).
// Env: IG_TOKEN, IG_USER_ID (optional), IG_TOKEN_KEY (only for IGAA tokens).
const TOKEN_FILE = 'state/ig_token.enc';
const ekey = () => crypto.createHash('sha256').update(env.IG_TOKEN_KEY).digest();
function encrypt(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', ekey(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', ekey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}
async function igToken() {
  if (!env.IG_TOKEN.startsWith('IG')) return env.IG_TOKEN;          // never-expiring token
  if (!env.IG_TOKEN_KEY) { console.log('   ⚠︎ 60-day token without IG_TOKEN_KEY: it will not be renewed'); return env.IG_TOKEN; }
  let st = null;
  try { st = decrypt((await readFile(TOKEN_FILE, 'utf8')).trim()); } catch {}
  if (!st || st.origin !== env.IG_TOKEN.slice(-12)) st = { token: env.IG_TOKEN, refreshed: 0, origin: env.IG_TOKEN.slice(-12) };
  const DAY = 86_400_000;
  if (Date.now() - st.refreshed > 7 * DAY) {
    try {
      const j = await req(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(st.token)}`);
      st = { ...st, token: j.access_token, refreshed: Date.now() };
      console.log(`   Instagram token renewed (valid ${Math.round(j.expires_in / 86400)} days)`);
    } catch (e) { console.error('   token renewal skipped: ' + e.message); st.refreshed = Date.now() - 6 * DAY; }
    await writeFile(TOKEN_FILE, encrypt(st) + '\n');
  }
  return st.token;
}
async function instagram() {
  const T = await igToken();
  const G = T.startsWith('IG') ? 'https://graph.instagram.com/v25.0' : 'https://graph.facebook.com/v25.0';
  let IG = env.IG_USER_ID;
  if (!IG) {
    const me = await req(`${G}/me?fields=user_id,id&access_token=${T}`).catch(() => ({}));
    IG = me.user_id || me.id;
  }
  if (!IG) throw new Error('Instagram account not found: add the IG_USER_ID secret');
  // GitHub release links redirect to a signed file URL: hand Instagram the final URL.
  const head = await fetch(env.VIDEO_URL, { method: 'HEAD', redirect: 'manual' });
  const videoUrl = head.headers.get('location') || env.VIDEO_URL;
  const c = await req(`${G}/${IG}/media`, { method: 'POST', body: new URLSearchParams({
    media_type: 'REELS', video_url: videoUrl, caption: cap.text, share_to_feed: 'true', access_token: T }) });
  let status = '';
  for (let i = 0; i < 60; i++) {                       // Instagram processing (≤ 10 min)
    await sleep(10_000);
    const s = await req(`${G}/${c.id}?fields=status_code,status&access_token=${T}`);
    status = s.status_code;
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error('Instagram rejected the video: ' + JSON.stringify(s));
  }
  if (status !== 'FINISHED') throw new Error('Instagram processing timed out');
  const p = await req(`${G}/${IG}/media_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: c.id, access_token: T }) });
  const m = await req(`${G}/${p.id}?fields=permalink&access_token=${T}`).catch(() => ({}));
  return m.permalink || `media ${p.id}`;
}

const PLATFORMS = {
  youtube:   { fn: youtube,   needs: ['MAKE_WEBHOOK_URL', 'VIDEO_URL'] },
  instagram: { fn: instagram, needs: ['IG_TOKEN', 'VIDEO_URL'] }
};

console.log('— Caption —\n' + cap.text + '\n————');
const results = {}, failed = [];
for (const p of cfg.plateformes.filter(p => PLATFORMS[p])) {
  const missing = PLATFORMS[p].needs.filter(k => !env[k]);
  if (DRY) { console.log(missing.length ? `⏭  ${p}: not configured (${missing.join(', ')})` : `🧪 ${p}: ready (dry run, nothing posted)`); continue; }
  if (missing.length) { console.log(`⏭  ${p}: not configured (${missing.join(', ')})`); continue; }
  console.log(`▶ ${p}…`);
  try { results[p] = await retry(PLATFORMS[p].fn); console.log(`✓ ${p}: ${results[p]}`); }
  catch (e) { failed.push(p); console.error(`✗ ${p}: ${e.message}`); }
}

if (Object.keys(results).length) {
  const hist = JSON.parse(await readFile('state/historique.json', 'utf8').catch(() => '[]'));
  hist.push({ date: meta.date, seed: meta.seed, signature: meta.signature, key: meta.key,
    chords: meta.chords.map(c => c.name).join(' '), links: results, failed });
  await writeFile('state/historique.json', JSON.stringify(hist, null, 1));
}
if (failed.length) { console.error(`Failed on: ${failed.join(', ')}`); process.exit(1); }
