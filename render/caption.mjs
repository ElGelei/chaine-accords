// Légende de la vidéo du jour, construite à partir de out/video.json (aucune API nécessaire).
const pick = (arr, seed) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return arr[h % arr.length]; };

const TXT = {
  fr: {
    hooks: {
      maj: ['Ferme les yeux trente secondes 🌙', 'Une petite suite d’accords pour souffler ✨', 'Ça va aller. 🤍', 'Ta pause douceur du jour 🎹', 'Respire, écoute, repose-toi 🍃'],
      min: ['Un peu de mélancolie douce 🌧️', 'Pour les soirs pensifs 🌙', 'Une suite en mineur, tout en douceur 🎹', 'La beauté des accords mineurs ✨']
    },
    spice: s => s ? `Le petit secret : ${s}.` : 'Rien que des accords de la gamme, zéro surprise, que du confort.',
    play: 'Joue-la au piano ou à la guitare 👇',
    cta: ['Envoie-la à quelqu’un qui a besoin de calme.', 'Enregistre-la pour ta prochaine pause.', 'Dis-moi en commentaire l’émotion que tu veux demain.'],
    yt: k => `Suite d’accords apaisante en ${k} 🎹 #Shorts`
  },
  en: {
    hooks: {
      maj: ['Close your eyes for thirty seconds 🌙', 'A little chord progression to breathe ✨', 'It’s going to be okay. 🤍', 'Your daily calm break 🎹', 'Breathe, listen, rest 🍃'],
      min: ['A bit of gentle melancholy 🌧️', 'For thoughtful evenings 🌙', 'A soft minor progression 🎹', 'The beauty of minor chords ✨']
    },
    spice: s => s ? `The little secret: ${s}.` : 'Only in-key chords: no surprises, just comfort.',
    play: 'Play it on piano or guitar 👇',
    cta: ['Send it to someone who needs some calm.', 'Save it for your next break.', 'Tell me in the comments which emotion you want tomorrow.'],
    yt: k => `Calming chord progression in ${k} 🎹 #Shorts`
  }
};
const KEY_FR = k => k.replace(/^([A-G])([♯♭]?)/, (_, n, a) => ({C:'Do',D:'Ré',E:'Mi',F:'Fa',G:'Sol',A:'La',B:'Si'})[n] + (a === '♯' ? ' dièse' : a === '♭' ? ' bémol' : ''));
const KEY_EN = k => k.replace(' majeur', ' major').replace(' mineur', ' minor');
const SPICE_EN = { 'dominante secondaire': 'a secondary dominant', 'accord emprunté (iv)': 'a borrowed minor iv chord', 'cadence rompue': 'a deceptive cadence', 'retard (sus4)': 'a sus4 suspension' };

export function buildCaption(meta, cfg) {
  const lang = cfg.langue === 'en' ? 'en' : 'fr', T = TXT[lang];
  const key = lang === 'en' ? KEY_EN(meta.key) : KEY_FR(meta.key);
  const spice = lang === 'en' ? (SPICE_EN[meta.spice] || meta.spice) : meta.spice;
  const half = meta.chords.length > 8 ? meta.chords.slice(0, Math.ceil(meta.chords.length / 2)) : meta.chords; // un passage de la boucle
  const grid = half.map(c => c.name).join(' → ');
  const tags = (lang === 'en' ? cfg.hashtags_en : cfg.hashtags_fr).join(' ');
  const hook = pick(T.hooks[meta.mode] || T.hooks.maj, meta.seed);
  const cta = pick(T.cta, meta.seed + 'cta');
  const text = `${hook}\n\n🎹 ${key}\n${grid}\n\n${T.spice(spice)}\n${T.play}\n\n${cta}\n\n${tags}`;
  return { text, short: `${hook} · ${key}`, youtubeTitle: T.yt(key).slice(0, 100) };
}
