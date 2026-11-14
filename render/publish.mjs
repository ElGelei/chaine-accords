// Publie out/video.mp4 sur toutes les plateformes via Upload-Post (une seule API pour
// TikTok, Instagram, YouTube et Facebook ; Upload-Post gère aussi le renouvellement des accès).
// Secrets attendus : UPLOAD_POST_API_KEY et UPLOAD_POST_USER.
// Sans ces secrets : simple répétition (la légende est affichée, rien n'est publié).
import { readFile, writeFile } from 'node:fs/promises';
import { buildCaption } from './caption.mjs';

const cfg = JSON.parse(await readFile('config.json', 'utf8'));
const meta = JSON.parse(await readFile('out/video.json', 'utf8'));
const cap = buildCaption(meta, cfg);
const KEY = process.env.UPLOAD_POST_API_KEY, USER = process.env.UPLOAD_POST_USER;
const platforms = (process.env.PLATFORMS || cfg.plateformes.join(',')).split(',').map(s => s.trim()).filter(Boolean);

console.log('— Légende —\n' + cap.text + '\n————');
if (!KEY || !USER) { console.log('ℹ︎ Secrets Upload-Post absents : répétition seulement, rien n’est publié.'); process.exit(0); }

const API = 'https://api.upload-post.com/api';
const headers = { Authorization: `Apikey ${KEY}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function upload() {
  const video = new Blob([await readFile('out/video.mp4')], { type: 'video/mp4' });
  const fd = new FormData();
  fd.append('user', USER);
  for (const p of platforms) fd.append('platform[]', p);
  fd.append('video', video, `accords-${meta.date}.mp4`);
  fd.append('title', cap.short);
  fd.append('description', cap.text);
  fd.append('tiktok_title', cap.text.slice(0, 2200));
  fd.append('instagram_title', cap.text);
  fd.append('media_type', 'REELS');
  fd.append('facebook_title', cap.short);
  fd.append('facebook_description', cap.text);
  fd.append('youtube_title', cap.youtubeTitle);
  fd.append('youtube_description', cap.text);
  fd.append('privacyStatus', 'public');
  fd.append('privacy_level', 'PUBLIC_TO_EVERYONE');
  fd.append('async_upload', 'true');
  const r = await fetch(`${API}/upload`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': `accords-${meta.date}-${meta.seed}` }, body: fd });
  const body = await r.text();
  if (!r.ok) throw new Error(`Upload-Post ${r.status} : ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

let res, last;
for (let i = 1; i <= 3; i++) {
  try { res = await upload(); break; }
  catch (e) { last = e; console.error(`Essai ${i} raté : ${e.message}`); await sleep(60_000 * i); }
}
if (!res) throw last;
console.log('Réponse : ' + JSON.stringify(res).slice(0, 800));

// Suivi de la publication asynchrone (jusqu'à 15 min)
const rid = res.request_id || res.requestId;
let finalStatus = 'envoyée';
if (rid) {
  for (let i = 0; i < 30; i++) {
    await sleep(30_000);
    const s = await fetch(`${API}/uploadposts/status?request_id=${encodeURIComponent(rid)}`, { headers }).then(r => r.json()).catch(() => null);
    if (!s) continue;
    const txt = JSON.stringify(s); const st = String(s.status || '').toLowerCase();
    console.log(`  statut : ${txt.slice(0, 300)}`);
    if (['completed', 'finished', 'success', 'done'].includes(st)) { finalStatus = 'publiée'; break; }
    if (['failed', 'error'].includes(st)) throw new Error('Publication refusée : ' + txt.slice(0, 800));
  }
}

const hist = JSON.parse(await readFile('state/historique.json', 'utf8').catch(() => '[]'));
hist.push({ date: meta.date, seed: meta.seed, signature: meta.signature, cle: meta.key,
  accords: meta.chords.map(c => c.name).join(' '), plateformes: platforms, statut: finalStatus, request_id: rid || null });
await writeFile('state/historique.json', JSON.stringify(hist, null, 1));
console.log(`✓ Vidéo ${finalStatus} sur : ${platforms.join(', ')}`);
