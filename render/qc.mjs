// Contrôle qualité de out/video.mp4 : refuse une vidéo vide, muette, noire, trop courte ou saturée.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const f = 'out/video.mp4';
const errs = [];

const size = statSync(f).size;
if (size < 300_000) errs.push(`fichier trop petit (${size} octets)`);

const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', f], { encoding: 'utf8' }));
const dur = +probe.format.duration;
const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio');
if (!v || v.width !== 1080 || v.height !== 1920) errs.push('pas de piste vidéo 1080×1920');
if (!a) errs.push('pas de piste audio');
if (!(dur >= 15 && dur <= 90)) errs.push(`durée anormale (${dur.toFixed(1)} s)`);

const stderr = execFileSync('sh', ['-c', `ffmpeg -i ${f} -af volumedetect -vn -f null - 2>&1`], { encoding: 'utf8' });
const mean = +(stderr.match(/mean_volume: (-?[\d.]+)/) || [])[1];
const max = +(stderr.match(/max_volume: (-?[\d.]+)/) || [])[1];
if (!(mean > -40)) errs.push(`son trop faible ou muet (moyenne ${mean} dB)`);
if (max > -0.05) errs.push(`son saturé (pic ${max} dB)`);

const lum = execFileSync('sh', ['-c', `ffmpeg -ss 5 -i ${f} -frames:v 1 -vf signalstats,metadata=print -f null - 2>&1`], { encoding: 'utf8' });
const yavg = +(lum.match(/YAVG=([\d.]+)/) || [])[1];
if (!(yavg > 12)) errs.push(`image noire (luminance ${yavg})`);

console.log(`QC : ${dur.toFixed(1)} s · ${(size / 1e6).toFixed(1)} Mo · son moyen ${mean} dB, pic ${max} dB · luminance ${yavg}`);
if (errs.length) { console.error('✗ Vidéo refusée : ' + errs.join(' ; ')); process.exit(1); }
console.log('✓ Vidéo validée');
