# ToneAdjust — Plan

## Contexte

ToneAdjust est une application web qui aide les guitaristes à reproduire fidèlement le son d'une chanson sur leur pédale multi-effets Valeton GP200. À partir d'un titre de chanson et d'un nom d'artiste, l'application :
1. Trouve et télécharge la vidéo YouTube la plus pertinente
2. Récupère les métadonnées de la chanson (titre, année, album, BPM)
3. Extrait et isole la piste guitare (séparation de sources par IA)
4. Analyse le son de la guitare (EQ, gain, reverb, delay, compression)
5. *(Phase 2)* Recherche sur le web le matériel/réglages connus du guitariste
6. *(Phase 2)* Traduit l'ensemble en paramètres Valeton GP200 et affiche une recommandation de patch

**Phase 1 (ce plan) :** Pipeline audio complet + affichage des analyses
**Phase 2 (plus tard) :** Mapping GP200, export du fichier patch, web researcher

---

## Architecture

```
toneadjust/
├── specs/
├── downloads/                        ← stockage des fichiers audio
│   └── {artiste}/
│       └── {chanson}/
│           ├── audio/
│           │   └── {artiste} - {chanson}.wav
│           └── stems/
│               ├── guitar.wav
│               ├── bass.wav
│               ├── vocals.wav
│               ├── drums.wav
│               └── other.wav        ← piano + autres fusionnés
├── backend/              ← Python + FastAPI
│   ├── app/
│   │   ├── main.py
│   │   ├── database.py              # SQLite (SQLAlchemy async)
│   │   ├── api/
│   │   │   └── routes.py
│   │   └── services/
│   │       ├── youtube_service.py   # yt-dlp : recherche + téléchargement
│   │       ├── metadata_service.py  # MusicBrainz + BPM librosa
│   │       ├── audio_processor.py   # Demucs : séparation des pistes
│   │       └── guitar_analyzer.py   # librosa : analyse spectrale guitare
│   ├── requirements.txt
│   └── .env.example
├── frontend/             ← React + Vite + TypeScript + shadcn/ui
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── SearchForm.tsx       # saisie artiste + chanson
│   │   │   ├── VideoSelector.tsx    # sélection parmi 5 résultats YouTube
│   │   │   ├── ProgressSteps.tsx    # progression en temps réel (SSE)
│   │   │   └── SongPage.tsx         # page chanson : métadonnées + stems + analyse
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
└── toneadjust.db         ← base SQLite (créée automatiquement)
```

---

## Stack technique

| Besoin | Librairie/Outil | Raison |
|---|---|---|
| Framework backend | **FastAPI** | Async, rapide, docs OpenAPI auto, SSE natif |
| Recherche + téléchargement YouTube | **yt-dlp** | Référence du domaine, supporte `ytsearch:` |
| Extraction audio | **ffmpeg** (via yt-dlp) | Standard, gère tous les formats |
| Séparation de la piste guitare | **Demucs** `htdemucs_6s` | Seul modèle isolant guitare séparément |
| Métadonnées musicales | **MusicBrainz** (`musicbrainzngs`) | Gratuit, sans clé API, riche |
| BPM | **librosa** `beat.tempo()` | Calcul direct sur l'audio |
| Analyse audio guitare | **librosa** | Centroïde spectral, contraste, MFCC, RT60... |
| Base de données | **SQLite** + SQLAlchemy async | Simple, sans serveur, local |
| Frontend | **React + Vite + TypeScript** | Dev rapide, typage fort |
| UI | **shadcn/ui + Tailwind CSS** | Composants modernes, thème dark zinc/amber |

---

## Base de données

Table `songs` :

| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `artist` | TEXT | Artiste (clé de recherche) |
| `song` | TEXT | Titre de la chanson (clé de recherche) |
| `youtube_url` | TEXT | URL de la vidéo sélectionnée |
| `title` | TEXT | Titre officiel (MusicBrainz) |
| `year` | INTEGER | Année de sortie |
| `album` | TEXT | Nom de l'album |
| `bpm` | INTEGER | Tempo en BPM (librosa) |
| `audio_path` | TEXT | Chemin vers le WAV téléchargé |
| `stems_dir` | TEXT | Chemin vers le dossier stems/ |
| `analysis_json` | TEXT | JSON : résultats analyse librosa guitare |
| `created_at` | DATETIME | Date de traitement |

---

## Pipeline de traitement

### Étape 1 — Recherche & sélection YouTube
- `POST /api/search` vérifie d'abord la DB (`artist` + `song`)
- Si déjà traité → retourne les données existantes directement
- Sinon → `yt-dlp ytsearch5:"{artist} {song}"` → retourne 5 résultats (titre, chaîne, durée, miniature, URL)
- **L'utilisateur sélectionne la vidéo** avant de lancer le téléchargement

### Étape 2 — Téléchargement audio
- `yt-dlp` télécharge en meilleure qualité, convertit en WAV
- Stocke dans `downloads/{artiste}/{chanson}/audio/{artiste} - {chanson}.wav`
- Nettoyage des caractères invalides dans les noms de dossiers

### Étape 3 — Métadonnées
- **MusicBrainz** : titre officiel, année de sortie, album
- **librosa** `beat.tempo()` sur le WAV complet → BPM
- Stockage en DB

### Étape 4 — Séparation des pistes (Demucs)
- Modèle `htdemucs_6s` (seul modèle Demucs isolant la guitare séparément)
- Fusion `piano` + `other` → `other.wav` via ffmpeg
- 5 stems dans `downloads/{artiste}/{chanson}/stems/` : guitar, bass, vocals, drums, other
- Stockage du chemin `stems_dir` en DB

### Étape 5 — Analyse du son de guitare (librosa)
À partir de `stems/guitar.wav` :

| Mesure | Indicateur |
|---|---|
| Centroïde spectral | Brillance (aigus/graves) |
| Contraste spectral (7 bandes) | Forme de l'EQ |
| MFCC | Empreinte tonale |
| Énergie RMS + facteur de crête | Dynamique / compression |
| HNR (rapport harmonique/bruit) | Niveau de distorsion |
| Rolloff spectral | Présence hautes fréquences |
| RT60 | Quantité de reverb |
| Autocorrélation | Détection delay/écho |

- Résultat sérialisé en JSON → stocké dans `analysis_json` en DB
- Affiché sur la page de la chanson

---

## Design de l'API

### `POST /api/search`
Vérifie si la chanson existe en DB, sinon lance la recherche YouTube.

**Requête :**
```json
{ "artist": "Metallica", "song": "Master of Puppets" }
```
**Réponse si déjà traitée :**
```json
{ "already_processed": true, "song": { ...données complètes... } }
```
**Réponse si non traitée :**
```json
{
  "results": [
    { "rank": 1, "title": "Master of Puppets (Official)", "channel": "Metallica", "duration": "8:35", "thumbnail": "...", "video_url": "https://youtube.com/..." },
    ...
  ]
}
```

### `POST /api/analyze`
Lance le pipeline complet sur la vidéo sélectionnée. Streaming SSE.

**Requête :**
```json
{ "artist": "Metallica", "song": "Master of Puppets", "video_url": "https://youtube.com/..." }
```

**Réponse (streaming SSE) :**
```
event: progress
data: {"step": "download", "status": "processing"}

event: progress
data: {"step": "download", "status": "done", "audio_path": "downloads/..."}

event: progress
data: {"step": "metadata", "status": "processing"}

event: progress
data: {"step": "metadata", "status": "done", "title": "Master of Puppets", "year": 1986, "album": "Master of Puppets", "bpm": 212}

event: progress
data: {"step": "demucs", "status": "processing"}

event: progress
data: {"step": "demucs", "status": "done", "stems": {"guitar": "...", "bass": "...", ...}}

event: progress
data: {"step": "analysis", "status": "processing"}

event: progress
data: {"step": "analysis", "status": "done", "analysis": {...}}

event: result
data: {"song": { ...données complètes de la chanson... }}
```

---

## UI (shadcn/ui + Tailwind, thème dark)

**Palette :**
- Fond : `zinc-950` (`#09090b`)
- Surface : `zinc-900` (`#18181b`)
- Bordures : `zinc-800` (`#27272a`)
- Texte : `zinc-50`
- Accent actif : `amber-500`

**Composants shadcn utilisés :** `Card`, `Badge`, `Button`, `Input`, `Separator`, `Skeleton`, `Progress`

**Routes :**
- `/` → `SearchForm` (artiste + chanson)
- `/analyze` → `VideoSelector` → `ProgressSteps`
- `/songs/:artist/:song` → `SongPage`

**SongPage affiche :**
- Header : titre, artiste, album, année, BPM (Badge amber)
- Lecteurs audio `<audio>` pour les 5 stems
- Section analyse guitare : brillance, distorsion, dynamique, reverb, delay, présence aigus
- Bouton "Générer le patch GP200" (désactivé — Phase 2)

---

## Étapes d'implémentation (Phase 1)

1. **Structure du projet** — scaffold backend + frontend, DB, dossier downloads
2. **`youtube_service.py`** — recherche + téléchargement yt-dlp
3. **`metadata_service.py`** — MusicBrainz + BPM librosa
4. **`guitar_analyzer.py`** — analyse spectrale librosa
5. **`audio_processor.py`** — séparation Demucs + fusion ffmpeg
6. **Routes FastAPI** — `POST /api/search` + `POST /api/analyze` (SSE)
7. **Frontend** — SearchForm, VideoSelector, ProgressSteps, SongPage

---

## Dépendances

**Backend (`requirements.txt`) :**
```
fastapi
uvicorn
yt-dlp
demucs
librosa
numpy
scipy
sqlalchemy
aiosqlite
musicbrainzngs
python-dotenv
httpx
```

**Frontend (`package.json`) :**
```
react, react-dom, typescript, vite
tailwindcss, @tailwindcss/vite
shadcn/ui
react-router-dom
```

---

## Variables d'environnement

```env
# backend/.env
DOWNLOAD_DIR=../../downloads
DATABASE_URL=sqlite+aiosqlite:///./toneadjust.db
```

---

## Vérification

1. Lancer le backend : `cd backend && uvicorn app.main:app --reload`
2. Lancer le frontend : `cd frontend && npm run dev`
3. Rechercher : Artiste = "Metallica", Chanson = "Master of Puppets"
4. Sélectionner une vidéo et suivre les 5 étapes en temps réel
5. Vérifier l'arborescence :
   ```
   downloads/Metallica/Master of Puppets/audio/Metallica - Master of Puppets.wav
   downloads/Metallica/Master of Puppets/stems/guitar.wav
   downloads/Metallica/Master of Puppets/stems/bass.wav
   downloads/Metallica/Master of Puppets/stems/vocals.wav
   downloads/Metallica/Master of Puppets/stems/drums.wav
   downloads/Metallica/Master of Puppets/stems/other.wav
   ```
6. Vérifier la SongPage : titre "Master of Puppets", 1986, BPM ~212, 5 lecteurs audio, analyse guitare affichée
7. Tester une deuxième recherche du même titre → doit afficher directement la SongPage (sans re-télécharger)
