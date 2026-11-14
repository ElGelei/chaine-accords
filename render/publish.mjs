// Publishes today's video (out/video.mp4, already online at VIDEO_URL) — 100 % free:
//   • YouTube Shorts : via a Make.com scenario (webhook → download → YouTube "Upload a video").
//   • Instagram Reels : directly via Meta's Graph API (system user token, never expires).
// Each platform runs only if its secrets exist; one failing platform doesn't block the other.
// The job fails at the end if any platform failed (→ GitHub e-mail).
//
// Env : VIDEO_URL, MAKE_WEBHOOK_URL, IG_TOKEN, IG_USER_ID, DRY_RUN=1
import { readFile, writeFile } from 'node:fs/promises';
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
// New Meta apps only offer "Unified login" (Facebook Login for Business). We use a *system user*
// token from Meta Business Suite: it never expires, so there is nothing to renew.
// Env: IG_TOKEN (system user token), IG_USER_ID (Instagram account ID, optional: auto-detected).
const G = 'https://graph.facebook.com/v25.0';
async function igUserId(T) {
  if (env.IG_USER_ID) return env.IG_USER_ID;
  for (const path of ['me/assigned_instagram_accounts?fields=id,username', 'me/accounts?fields=instagram_business_account']) {
    const j = await req(`${G}/${path}&access_token=${T}`).catch(() => null);
    const d = j?.data?.[0];
    const id = d?.instagram_business_account?.id || (d && !d.instagram_business_account && d.id);
    if (id) return id;
  }
  throw new Error('Instagram account not found: add the IG_USER_ID secret');
}
async function instagram() {
  const T = env.IG_TOKEN, IG = await igUserId(T);
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
