// Publishes today's video (out/video.mp4, already online at VIDEO_URL) — 100 % free:
//   • YouTube Shorts : via a Make.com scenario (webhook → download → YouTube "Upload a video").
//   • Instagram Reels : directly via Meta's "Instagram API with Instagram Login" (no Facebook Page).
// Each platform runs only if its secrets exist; one failing platform doesn't block the other.
// The job fails at the end if any platform failed (→ GitHub e-mail).
//
// Env : VIDEO_URL, MAKE_WEBHOOK_URL, IG_TOKEN (first token), IG_TOKEN_KEY (encryption key), DRY_RUN=1
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

// ---------- Instagram token: stored encrypted in the repo, renewed automatically ----------
const TOKEN_FILE = 'state/ig_token.enc';
const key = () => crypto.createHash('sha256').update(env.IG_TOKEN_KEY).digest();
function encrypt(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}
async function igToken() {
  let st = null;
  try { st = decrypt((await readFile(TOKEN_FILE, 'utf8')).trim()); } catch { /* first run */ }
  if (!st) st = { token: env.IG_TOKEN, refreshed: 0 };
  const DAY = 86_400_000;
  if (Date.now() - st.refreshed > 7 * DAY) {          // renew at most once a week (valid 60 days)
    try {
      const j = await req(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(st.token)}`);
      st = { token: j.access_token, refreshed: Date.now() };
      await writeFile(TOKEN_FILE, encrypt(st) + '\n');
      console.log(`   Instagram token renewed (valid ${Math.round(j.expires_in / 86400)} days)`);
    } catch (e) {
      console.error('   token renewal skipped: ' + e.message);
      if (!st.refreshed) await writeFile(TOKEN_FILE, encrypt({ token: st.token, refreshed: Date.now() - 6 * DAY }) + '\n');
    }
  }
  return st.token;
}

// ---------- Instagram Reels ----------
async function instagram() {
  const T = await igToken(), IG = 'https://graph.instagram.com';
  const me = await req(`${IG}/me?fields=user_id,username&access_token=${T}`);
  // GitHub release links redirect to a signed file URL: hand Instagram the final URL.
  const head = await fetch(env.VIDEO_URL, { method: 'HEAD', redirect: 'manual' });
  const videoUrl = head.headers.get('location') || env.VIDEO_URL;
  const c = await req(`${IG}/${me.user_id}/media`, { method: 'POST', body: new URLSearchParams({
    media_type: 'REELS', video_url: videoUrl, caption: cap.text, share_to_feed: 'true', access_token: T }) });
  let status = '';
  for (let i = 0; i < 60; i++) {                       // Instagram processing (≤ 10 min)
    await sleep(10_000);
    const s = await req(`${IG}/${c.id}?fields=status_code,status&access_token=${T}`);
    status = s.status_code;
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error('Instagram rejected the video: ' + JSON.stringify(s));
  }
  if (status !== 'FINISHED') throw new Error('Instagram processing timed out');
  const p = await req(`${IG}/${me.user_id}/media_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: c.id, access_token: T }) });
  const m = await req(`${IG}/${p.id}?fields=permalink&access_token=${T}`).catch(() => ({}));
  return m.permalink || `@${me.username} media ${p.id}`;
}

const PLATFORMS = {
  youtube:   { fn: youtube,   needs: ['MAKE_WEBHOOK_URL', 'VIDEO_URL'] },
  instagram: { fn: instagram, needs: ['IG_TOKEN_KEY', 'VIDEO_URL'] }
};

console.log('— Caption —\n' + cap.text + '\n————');
const results = {}, failed = [];
for (const p of cfg.plateformes.filter(p => PLATFORMS[p])) {
  const missing = PLATFORMS[p].needs.filter(k => !env[k]);
  if (p === 'instagram' && !env.IG_TOKEN) {
    try { await readFile(TOKEN_FILE); } catch { missing.push('IG_TOKEN'); }
  }
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
