# Chaîne d'accords — moteur automatique

Une vidéo verticale (1080×1920, ~35 s) par jour : une suite d'accords « confort »
(stabilité → éloignement → tension → retour), jouée en coton + piano feutré,
avec la petite héroïne qui marche dans un décor pixel art et les voix en lucioles.

## Contenu
- `engine/engine.html` — le moteur (même code que le prototype). Ouvert normalement : mode interactif.
  Avec `?render=1&seed=…` : mode rendu déterministe (même graine = même vidéo).
- `render/render.mjs` — pilote le moteur dans un navigateur sans écran, calcule l'audio hors ligne
  et assemble le MP4 avec ffmpeg. Écrit aussi `out/<graine>.json` (tonalité, accords, épice, décor).
- `.github/workflows/rendu.yml` — rendu automatique chaque jour (étape 1 : la vidéo est déposée
  en artefact téléchargeable ; la publication viendra à l'étape 3).

## Lancer en local (facultatif)
    npm install
    npx playwright install chromium
    node render/render.mjs            # graine = date du jour
    node render/render.mjs ma-graine  # autre graine

## Feuille de route
1. ✅ Rendu MP4 automatique
2. Réserve d'avance, historique anti-doublon, contrôle qualité
3. Publication (YouTube Shorts, puis Instagram, puis TikTok) + légendes
4. Renouvellement des jetons, tentatives, alertes
