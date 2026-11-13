// Rend une vidéo verticale 1080×1920 à partir du moteur (engine/engine.html).
// Usage : node render/render.mjs [graine] [dossier_sortie]
//   graine : par défaut la date du jour (AAAA-MM-JJ) → une vidéo différente chaque jour, reproductible.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const seed = process.argv[2] || new Date().toISOString().slice(0, 10);
const outDir = process.argv[3] || 'out';
const FPS = 30, W = 1080, H = 1920;

await mkdir(outDir, { recursive: true });
const base = path.join(outDir, seed);
const engine = pathToFileURL(path.resolve('engine/engine.html')).href + `?render=1&seed=${encodeURIComponent(seed)}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(engine);
await page.waitForFunction('window.__ready === true', null, { timeout: 60000 });

const meta = await page.evaluate('window.__meta');
console.log(`▶ ${seed} · ${meta.key} · ${meta.chords.map(c => c.name).join(' ')} · ${meta.duration.toFixed(1)} s`);

// 1) audio hors ligne (rendu plus rapide que le temps réel, identique au prototype)
const wavB64 = await page.evaluate('window.__renderAudio()');
await writeFile(`${base}.wav`, Buffer.from(wavB64, 'base64'));

// 2) images, envoyées directement à ffmpeg
const total = Math.ceil((meta.duration + 1.5) * FPS);
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-i', `${base}.wav`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
  `${base}.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });

for (let f = 0; f < total; f++) {
  if (f > 0) await page.evaluate(`window.__frame(${1 / FPS})`);
  const img = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!ff.stdin.write(img)) await new Promise(r => ff.stdin.once('drain', r));
  if (f % 150 === 0) console.log(`  image ${f}/${total}`);
}
ff.stdin.end();
await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
await browser.close();

await writeFile(`${base}.json`, JSON.stringify({ seed, ...meta }, null, 2));
console.log(`✓ ${base}.mp4`);
