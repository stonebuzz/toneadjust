<div align="center">

```
████████╗ ██████╗ ███╗   ██╗███████╗ █████╗ ██████╗      ██╗██╗   ██╗███████╗████████╗
╚══██╔══╝██╔═══██╗████╗  ██║██╔════╝██╔══██╗██╔══██╗     ██║██║   ██║██╔════╝╚══██╔══╝
   ██║   ██║   ██║██╔██╗ ██║█████╗  ███████║██║  ██║     ██║██║   ██║███████╗   ██║
   ██║   ██║   ██║██║╚██╗██║██╔══╝  ██╔══██║██║  ██║██   ██║██║   ██║╚════██║   ██║
   ██║   ╚██████╔╝██║ ╚████║███████╗██║  ██║██████╔╝╚█████╔╝╚██████╔╝███████║   ██║
   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝╚═════╝  ╚════╝  ╚═════╝ ╚══════╝   ╚═╝
```

**Analyse, sépare et lis les tablatures de tes morceaux de guitare favoris.**

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

</div>

---

## Qu'est-ce que c'est ?

**ToneAdjust** est une application web qui permet de :

1. **Rechercher un morceau** par artiste + titre via MusicBrainz
2. **Télécharger l'audio** depuis YouTube (yt-dlp)
3. **Séparer les pistes** en stems indépendants (guitare, basse, voix, batterie, autre) via Demucs
4. **Analyser la guitare** : tonalité, tempo, spectre, dynamique, reverb, delay…
5. **Lire une tablature Guitar Pro** (.gp, .gp3, .gp4, .gp5, .gpx) avec le lecteur AlphaTab intégré — curseur synchronisé, toutes les options de lecture actives
6. **Importer ta propre tablature** si aucune n'est disponible

---

## Architecture

```
toneadjust/
├── backend/               # API FastAPI (Python)
│   ├── app/
│   │   ├── api/
│   │   │   └── routes.py  # Tous les endpoints REST
│   │   ├── services/
│   │   │   ├── youtube_service.py        # Téléchargement audio (yt-dlp)
│   │   │   ├── audio_processor.py        # Séparation stems (Demucs)
│   │   │   ├── guitar_analyzer.py        # Analyse spectrale (librosa)
│   │   │   ├── musicbrainz_search_service.py  # Recherche MusicBrainz
│   │   │   └── metadata_service.py       # Métadonnées (genres, labels, membres)
│   │   ├── database.py    # SQLite async (SQLAlchemy + aiosqlite)
│   │   └── main.py        # App FastAPI + CORS + static files
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/              # App React + Vite
│   ├── src/
│   │   ├── components/
│   │   │   ├── SongPage.tsx        # Page principale d'une chanson
│   │   │   ├── GuitarProPlayer.tsx # Lecteur tablature (AlphaTab)
│   │   │   ├── SearchForm.tsx      # Formulaire de recherche
│   │   │   ├── AdminPage.tsx       # Page admin
│   │   │   └── ui/                 # Composants UI (Badge, Button…)
│   │   └── main.tsx
│   ├── public/            # Assets statiques (non versionnés, voir Setup)
│   ├── package.json
│   └── vite.config.ts
│
└── downloads/             # Fichiers téléchargés (non versionné)
    └── {mb_recording_id}/
        ├── audio.mp3
        ├── stems/         # guitar.wav, bass.wav, vocals.wav…
        └── tab/           # fichier .gp* importé
```

---

## Stack technique

| Couche | Technologie |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4 |
| Lecteur tablature | AlphaTab 1.8 |
| Backend | FastAPI, Python 3.11+ |
| Base de données | SQLite (async via aiosqlite + SQLAlchemy) |
| Séparation audio | Demucs (Meta AI) |
| Analyse audio | librosa, numpy, scipy |
| Téléchargement | yt-dlp |
| Métadonnées | MusicBrainz API |

---

## Prérequis

- **Python 3.11+**
- **Node.js 20+** + npm
- **FFmpeg** (requis par yt-dlp et Demucs)
- GPU optionnel (Demucs est plus rapide avec CUDA)

```bash
# Ubuntu / Debian
sudo apt install ffmpeg python3.11 python3.11-venv nodejs npm
```

---

## Installation

### 1. Cloner le dépôt

```bash
git clone git@github.com:stonebuzz/toneadjust.git
cd toneadjust
```

### 2. Backend

```bash
cd backend

# Créer et activer l'environnement virtuel
python3 -m venv .venv
source .venv/bin/activate

# Installer les dépendances
pip install -r requirements.txt

# Copier et adapter la configuration
cp .env.example .env
```

`.env` par défaut :
```env
DOWNLOAD_DIR=../../downloads
DATABASE_URL=sqlite+aiosqlite:///./toneadjust.db
```

### 3. Frontend

```bash
cd frontend

# Installer les dépendances Node
npm install
```

#### Assets publics requis (non versionnés)

Les fichiers binaires volumineux ne sont pas inclus dans le dépôt. Il faut les copier depuis les packages npm ou les télécharger :

```bash
cd frontend

# AlphaTab — copier depuis node_modules
cp node_modules/@coderline/alphatab/dist/alphaTab.mjs          public/alphaTab.core.mjs
cp node_modules/@coderline/alphatab/dist/alphaTab.worker.mjs   public/alphaTab.worker.mjs
cp node_modules/@coderline/alphatab/dist/alphaTab.worklet.mjs  public/alphaTab.worklet.mjs

# Polices Bravura — copier depuis node_modules
cp -r node_modules/@coderline/alphatab/dist/font public/font

# SoundFont Sonivox — à télécharger
curl -L https://github.com/CoderLine/alphaTab/raw/develop/src/assets/soundfont/sonivox.sf2 \
     -o public/sonivox.sf2
```

---

## Lancer l'application

### Backend

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

> API disponible sur `http://localhost:8000`
> Documentation Swagger : `http://localhost:8000/docs`

### Frontend

```bash
cd frontend
npm run dev
```

> Application disponible sur `http://localhost:5173`

---

## Redémarrer

### Redémarrer le backend

```bash
cd backend
source .venv/bin/activate

# Tuer l'instance existante si besoin
pkill -f "uvicorn app.main:app"

# Relancer
uvicorn app.main:app --reload --port 8000
```

### Redémarrer le frontend

```bash
cd frontend

# Tuer l'instance existante
pkill -f "vite"

# Relancer
npm run dev
```

### Relancer les deux en une commande

```bash
# Depuis la racine du projet
(cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000) &
(cd frontend && npm run dev) &
```

---

## Endpoints API

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/songs` | Lister toutes les chansons |
| `GET` | `/api/songs/{mb_id}` | Détail d'une chanson |
| `POST` | `/api/search` | Rechercher via MusicBrainz |
| `POST` | `/api/analyze` | Télécharger + analyser un morceau |
| `GET` | `/api/tab/{mb_id}` | Vérifier si une tablature existe |
| `GET` | `/api/tab/{mb_id}/file` | Télécharger le fichier tablature |
| `POST` | `/api/tab/{mb_id}/upload` | Importer une tablature (.gp*) |
| `GET` | `/audio/{path}` | Servir les fichiers audio (stems) |

---

## Fonctionnement détaillé

```
Utilisateur
    │
    ▼
[Recherche] ──► MusicBrainz API ──► Liste de morceaux correspondants
    │
    ▼
[Sélection] ──► YouTube search (yt-dlp) ──► Vidéos candidates
    │
    ▼
[Analyse]
    ├── Téléchargement audio (yt-dlp → MP3)
    ├── Séparation stems (Demucs → guitar / bass / vocals / drums / other)
    ├── Analyse spectrale (librosa → tonalité, tempo, spectre, dynamique…)
    └── Récupération métadonnées (MusicBrainz → genres, labels, membres)
    │
    ▼
[Page chanson]
    ├── Infos : titre, artiste, album, année, genres, membres, labels
    ├── Pistes audio : lecture individuelle, mute/solo, volumes, waveform
    ├── Analyse guitare : spectre, dynamique, tonalité, effets
    └── Tablature Guitar Pro
            ├── Si présente → lecteur AlphaTab (play, curseur, boucle…)
            └── Sinon      → formulaire d'import
```

---

## Structure `downloads/`

```
downloads/
└── {mb_recording_id}/
    ├── audio.mp3          ← audio original téléchargé
    ├── stems/
    │   ├── guitar.wav
    │   ├── bass.wav
    │   ├── vocals.wav
    │   ├── drums.wav
    │   └── other.wav
    └── tab/
        └── mysong.gp5     ← tablature importée
```

---

## Contribution

```bash
# Créer une branche
git checkout -b feature/ma-feature

# Commiter
git commit -m "feat: description de la feature"

# Pusher
git push origin feature/ma-feature
```

---

<div align="center">

Fait avec ♪ par [stonebuzz](https://github.com/stonebuzz)

</div>
