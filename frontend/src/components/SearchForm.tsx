import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Maximize2, Music2, Search, Settings } from 'lucide-react'
import { AnalysisModal } from '@/components/AnalysisModal'
import type { TrackRecord } from '@/components/AnalysisModal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { API_BASE, apiUrl } from '@/lib/api'

interface RecentSong {
  id: number
  artist: string
  song: string
  title: string | null
  album: string | null
  year: number | null
  bpm: number | null
  stems_dir: string | null
  mb_recording_id: string | null
}

export function SearchForm() {
  const [artistInput, setArtistInput] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recentSongs, setRecentSongs] = useState<RecentSong[]>([])

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [trackSearching, setTrackSearching] = useState(false)
  const [trackRecordings, setTrackRecordings] = useState<TrackRecord[]>([])
  const [modalArtist, setModalArtist] = useState('')
  const [modalSong, setModalSong] = useState('')

  const artistRef = useRef<HTMLInputElement>(null)
  const searchAbort = useRef<AbortController | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    fetch(apiUrl('/api/songs'))
      .then(r => r.json())
      .then(data => setRecentSongs(data.songs ?? []))
      .catch(() => {})
    artistRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!titleInput.trim()) return
    setError(null)

    searchAbort.current?.abort()
    searchAbort.current = new AbortController()

    setModalArtist(artistInput.trim())
    setModalSong(titleInput.trim())
    setTrackRecordings([])
    setTrackSearching(true)
    setModalOpen(true)

    try {
      const res = await fetch(apiUrl('/api/track-search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: artistInput.trim(), title: titleInput.trim() }),
        signal: searchAbort.current.signal,
      })
      const data = await res.json()
      setTrackRecordings(data.recordings ?? [])
      setTrackSearching(false)
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setModalOpen(false)
        setError('Impossible de joindre le serveur.')
      }
    }
  }

  function handleModalClose() {
    searchAbort.current?.abort()
    setModalOpen(false)
    fetch(apiUrl('/api/songs'))
      .then(r => r.json())
      .then(data => setRecentSongs(data.songs ?? []))
      .catch(() => {})
  }

  function handleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Top banner */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500">
            <Music2 className="h-4 w-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-base font-semibold tracking-tight text-slate-900">ToneAdjust</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin')} title="Administration">
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleFullscreen} title="Plein écran">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Bannière "pas de backend" */}
      {!API_BASE && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 text-center text-sm text-amber-800">
          <span className="font-semibold">Mode démonstration</span> — Cette interface nécessite un backend local pour fonctionner.{' '}
          <a
            href="https://github.com/stonebuzz/toneadjust#installation"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-amber-900"
          >
            Voir le README
          </a>
        </div>
      )}

      {/* Main content */}
      <main className="flex flex-col items-center gap-12 px-4 pb-12 pt-16">
        {/* Search section */}
        <div className="w-full max-w-xl space-y-3">
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Analysez une chanson</h1>
            <p className="text-sm text-slate-500">
              Recherchez une chanson pour extraire ses stems et paramètres guitare
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  ref={artistRef}
                  value={artistInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setArtistInput(e.target.value)}
                  placeholder="Artiste"
                />
              </div>
              <div className="relative flex-1">
                <Input
                  value={titleInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitleInput(e.target.value)}
                  placeholder="Titre"
                />
              </div>
            </div>
            <Button type="submit" disabled={!titleInput.trim() || !API_BASE} className="w-full gap-2">
              <Search className="h-4 w-4" />
              Rechercher
            </Button>
          </form>

          {error && <p className="text-center text-sm text-red-500">{error}</p>}
        </div>

        {/* Recent songs */}
        {recentSongs.length > 0 && (
          <div className="w-full max-w-xl space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-700">Ajouté récemment</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="grid gap-3">
              {recentSongs.map(s => (
                <Card
                  key={s.id}
                  className="flex cursor-pointer items-center gap-4 p-4 transition-all hover:border-slate-300 hover:shadow-md"
                  onClick={() => {
                    if (s.mb_recording_id) {
                      navigate(`/songs/${s.mb_recording_id}`)
                    }
                  }}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                    <Music2 className="h-5 w-5 text-slate-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {s.title ?? s.song}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {s.artist}
                      {s.album ? ` · ${s.album}` : ''}
                      {s.year  ? ` · ${s.year}`  : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {s.bpm && <Badge variant="amber">{s.bpm} BPM</Badge>}
                    {s.stems_dir
                      ? <Badge variant="success">Stems</Badge>
                      : <Badge variant="muted">En cours</Badge>
                    }
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Analysis modal */}
      <AnalysisModal
        isOpen={modalOpen}
        onClose={handleModalClose}
        artist={modalArtist}
        song={modalSong}
        trackSearching={trackSearching}
        trackRecordings={trackRecordings}
      />
    </div>
  )
}
