// Rend la vidéo du jour (1080×1920) à partir du moteur engine/engine.html.
// Usage : node render/render.mjs [graine]
//   graine : par défaut la date du jour à Paris (AAAA-MM-JJ).
// Anti-doublon : si la suite tirée a déjà été publiée récemment (state/historique.json),
// on essaie la graine suivante (graine-2, graine-3…) jusqu'à trouver une suite nouvelle.
// Sortie : out/video.mp4 + out/video.json
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const today = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const baseSeed = process.argv[2] || today;
const FPS = 30, W = 1080, H = 1920, OUT = 'out';
await mkdir(OUT, { recursive: true });

const history = JSON.parse(await readFile('state/historique.json', 'utf8').catch(() => '[]'));
const recent = new Set(history.slice(-90).map(h => h.signature));
const signature = m => `${m.mode}|${m.chords.map(c => c.degree).join('-')}|${m.spice}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const engine = s => pathToFileURL(path.resolve('engine/engine.html')).href + `?render=1&seed=${encodeURIComponent(s)}`;

let seed, meta;
for (let k = 1; k <= 25; k++) {
  seed = k === 1 ? baseSeed : `${baseSeed}-${k}`;
  await page.goto(engine(seed));
  await page.waitForFunction('window.__ready === true', null, { timeout: 60000 });
  meta = await page.evaluate('window.__meta');
  if (!recent.has(signature(meta))) break;
  console.log(`  ${seed} : suite déjà publiée récemment, on en tire une autre`);
}
meta.signature = signature(meta);
console.log(`▶ ${seed} · ${meta.key} · ${meta.chords.map(c => c.name).join(' ')} · ${meta.duration.toFixed(1)} s`);

const wav = path.join(OUT, 'video.wav'), mp4 = path.join(OUT, 'video.mp4');
await writeFile(wav, Buffer.from(await page.evaluate('window.__renderAudio()'), 'base64'));

const total = Math.ceil((meta.duration + 1.5) * FPS);
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-i', wav,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', mp4],
  { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg a échoué (' + c + ')'))));

for (let f = 0; f < total; f++) {
  if (f > 0) await page.evaluate(`window.__frame(${1 / FPS})`);
  const img = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!ff.stdin.write(img)) await new Promise(r => ff.stdin.once('drain', r));
  if (f % 300 === 0) console.log(`  image ${f}/${total}`);
}
ff.stdin.end();
await done;
await browser.close();

await writeFile(path.join(OUT, 'video.json'), JSON.stringify({ date: today, seed, ...meta }, null, 2));
console.log(`✓ ${mp4}`);
