import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { AlphaTabApi, PlayerMode } from '@coderline/alphatab'
import {
  Play, Pause, Square, Repeat, Volume2, Timer,
  Upload, RefreshCw, FileMusic, Guitar, Drum, Mic2, Music2,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiUrl } from '@/lib/api'

// ── Types ──────────────────────────────────────────────────────────────────────

interface TabInfo {
  exists: boolean
  filename?: string
  url?: string
}

interface Track {
  name: string
  index: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function trackIcon(name: string) {
  const n = name.toLowerCase()
  if (n.includes('bass')) return Guitar
  if (n.includes('guitar') || n.includes('guit')) return Guitar
  if (n.includes('drum') || n.includes('perc')) return Drum
  if (n.includes('vocal') || n.includes('voice') || n.includes('chant')) return Mic2
  return Music2
}

// ── AlphaTabViewer ─────────────────────────────────────────────────────────────

export interface AlphaTabViewerHandle {
  play: () => void
  pause: () => void
}

const AlphaTabViewer = forwardRef<AlphaTabViewerHandle, {
  fileUrl: string
  onTracksLoaded: (tracks: Track[]) => void
}>(function AlphaTabViewer({ fileUrl, onTracksLoaded }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<AlphaTabApi | null>(null)
  const pendingPlayRef = useRef(false)

  const [tracks, setTracks] = useState<Track[]>([])
  const [selectedTrack, setSelectedTrack] = useState(0)
  const [scoreLoaded, setScoreLoaded] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [endTime, setEndTime] = useState(0)
  const [isLooping, setIsLooping] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0)
  const [volume, setVolume] = useState(1.0)
  const [metronomeOn, setMetronomeOn] = useState(false)
  const [countInOn, setCountInOn] = useState(false)

  useImperativeHandle(ref, () => ({
    play: () => {
      const api = apiRef.current
      if (!api) return
      if (api.isReadyForPlayback) api.play()
      else pendingPlayRef.current = true
    },
    pause: () => {
      pendingPlayRef.current = false
      apiRef.current?.pause()
    },
  }), [])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AlphaTabApi(el as any, {
      file: fileUrl,
      core: {
        fontDirectory: '/font/',
        scriptFile: '/alphaTab.core.mjs',
        useWorkers: false,
      },
      display: {
        scale: 0.9,
        layoutMode: 0, // Page
      },
      player: {
        playerMode: PlayerMode.EnabledSynthesizer,
        soundFont: '/sonivox.sf2',
        scrollElement: el,
        enableCursor: true,
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api.scoreLoaded.on((score: any) => {
      const list: Track[] = score.tracks.map((t: any, i: number) => ({ name: t.name, index: i }))
      setTracks(list)
      onTracksLoaded(list)
      const guitarIdx = score.tracks.findIndex((t: any) =>
        t.name.toLowerCase().includes('guitar') || t.name.toLowerCase().includes('guit')
      )
      const idx = guitarIdx >= 0 ? guitarIdx : 0
      setSelectedTrack(idx)
      api.renderTracks([score.tracks[idx]])
      setScoreLoaded(true)
    })

    api.playerReady.on(() => {
      setIsReady(true)
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false
        api.play()
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api.playerStateChanged.on((args: any) => {
      setIsPlaying(args.state === 1)
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api.playerPositionChanged.on((args: any) => {
      setCurrentTime(args.currentTime)
      if (args.endTime > 0) setEndTime(args.endTime)
    })

    // Clic sur une note → repositionner le curseur de lecture
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api.beatMouseDown.on((beat: any) => {
      api.tickPosition = beat.absoluteDisplayStart
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api.error.on((e: any) => console.error('[AlphaTab]', e))

    apiRef.current = api

    return () => {
      pendingPlayRef.current = false
      try { api.destroy() } catch (_) { /* ignore */ }
      apiRef.current = null
      setScoreLoaded(false)
      setIsReady(false)
      setIsPlaying(false)
      setCurrentTime(0)
      setEndTime(0)
      setTracks([])
    }
  }, [fileUrl])

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handlePlayPause() {
    const api = apiRef.current
    if (!api) return
    if (api.isReadyForPlayback) api.playPause()
    else pendingPlayRef.current = !pendingPlayRef.current
  }

  function handleStop() {
    pendingPlayRef.current = false
    apiRef.current?.stop()
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    if (apiRef.current) apiRef.current.timePosition = Number(e.target.value)
  }

  function handleLoopToggle() {
    const api = apiRef.current; if (!api) return
    const next = !isLooping
    api.isLooping = next
    setIsLooping(next)
  }

  function handleMetronomeToggle() {
    const api = apiRef.current; if (!api) return
    const next = !metronomeOn
    api.metronomeVolume = next ? 1 : 0
    setMetronomeOn(next)
  }

  function handleCountInToggle() {
    const api = apiRef.current; if (!api) return
    const next = !countInOn
    api.countInVolume = next ? 1 : 0
    setCountInOn(next)
  }

  function handleSpeedChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const speed = Number(e.target.value)
    if (apiRef.current) apiRef.current.playbackSpeed = speed
    setPlaybackSpeed(speed)
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value)
    if (apiRef.current) apiRef.current.masterVolume = v
    setVolume(v)
  }

  function handleTrackChange(idx: number) {
    const api = apiRef.current
    if (!api?.score) return
    setSelectedTrack(idx)
    api.renderTracks([api.score.tracks[idx]])
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const btn = 'flex items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed'
  const btnSm = `${btn} h-6 w-6 text-slate-500 hover:text-slate-800 hover:bg-slate-200`
  const btnToggle = (on: boolean) =>
    cn(btnSm, on && 'text-amber-600 bg-amber-50 hover:bg-amber-100 hover:text-amber-700')
  const sep = 'h-4 w-px bg-slate-200 mx-0.5'

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col">
      {/* Barre de contrôles */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-200 bg-slate-50 flex-wrap">

        {/* Play / Pause */}
        <button
          onClick={handlePlayPause}
          disabled={!scoreLoaded}
          className={cn(btn, 'h-7 w-7 rounded-full bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-30')}
          title={isPlaying ? 'Pause' : 'Lecture'}
        >
          {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </button>

        {/* Stop */}
        <button onClick={handleStop} disabled={!scoreLoaded} className={btnSm} title="Arrêt">
          <Square className="h-3.5 w-3.5" />
        </button>

        <div className={sep} />

        {/* Seek + temps */}
        <div className="flex items-center gap-2 flex-1 min-w-[160px]">
          <input
            type="range" min={0} max={endTime || 1} value={currentTime} step={100}
            onChange={handleSeek} disabled={!scoreLoaded}
            className="flex-1 h-1 cursor-pointer accent-amber-500 disabled:opacity-30"
          />
          <span className="text-[11px] text-slate-400 font-mono shrink-0 tabular-nums">
            {fmtMs(currentTime)} / {fmtMs(endTime)}
          </span>
        </div>

        <div className={sep} />

        {/* Loop */}
        <button onClick={handleLoopToggle} disabled={!scoreLoaded} className={btnToggle(isLooping)} title="Boucle">
          <Repeat className="h-3.5 w-3.5" />
        </button>

        {/* Métronome */}
        <button onClick={handleMetronomeToggle} disabled={!scoreLoaded} className={btnToggle(metronomeOn)} title="Métronome">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 3 19 21 12 17 5 21" />
            <line x1="12" y1="11" x2="16" y2="13" />
          </svg>
        </button>

        {/* Count-in */}
        <button onClick={handleCountInToggle} disabled={!scoreLoaded} className={btnToggle(countInOn)} title="Count-in">
          <Timer className="h-3.5 w-3.5" />
        </button>

        <div className={sep} />

        {/* Vitesse */}
        <select
          value={playbackSpeed} onChange={handleSpeedChange} disabled={!scoreLoaded}
          className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded px-1 py-0.5 outline-none cursor-pointer hover:border-slate-300 disabled:opacity-30"
          title="Vitesse"
        >
          {[0.25, 0.5, 0.75, 1.0].map(s => (
            <option key={s} value={s}>{s === 1 ? '1×' : `${s}×`}</option>
          ))}
        </select>

        <div className={sep} />

        {/* Volume */}
        <div className="flex items-center gap-1">
          <Volume2 className="h-3 w-3 text-slate-400 shrink-0" />
          <input
            type="range" min={0} max={3} step={0.05} value={volume}
            onChange={handleVolumeChange} disabled={!scoreLoaded}
            className="w-16 h-1 cursor-pointer accent-amber-500 disabled:opacity-30"
            title="Volume (0–3×)"
          />
        </div>

        {/* Statut */}
        {!scoreLoaded && (
          <span className="text-[10px] text-slate-400 ml-auto italic">Chargement…</span>
        )}
        {scoreLoaded && !isReady && (
          <span className="text-[10px] text-slate-400 ml-auto italic">Audio…</span>
        )}
      </div>

      {/* Corps : sidebar pistes + partition */}
      <div className="flex min-h-0">

        {/* Sidebar pistes (visible si >1 piste) */}
        {tracks.length > 1 && (
          <div className="flex flex-col border-r border-slate-100 shrink-0 w-44 py-1 overflow-y-auto max-h-[600px]">
            <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Pistes</p>
            {tracks.map(t => {
              const Icon = trackIcon(t.name)
              return (
                <button
                  key={t.index}
                  onClick={() => handleTrackChange(t.index)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-xs text-left w-full transition-colors',
                    selectedTrack === t.index
                      ? 'bg-amber-50 text-amber-700 font-medium border-r-2 border-amber-500'
                      : 'text-slate-500 hover:bg-slate-50',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t.name}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Partition */}
        <div ref={containerRef} style={{ position: 'relative', display: 'block', width: '100%', minHeight: 400 }} />
      </div>
    </div>
  )
})

// ── GuitarProPlayer ────────────────────────────────────────────────────────────

export function GuitarProPlayer({ mbRecordingId }: { mbRecordingId: string }) {
  const [tabInfo, setTabInfo] = useState<TabInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    fetch(apiUrl(`/api/tab/${mbRecordingId}`))
      .then(r => r.json())
      .then(setTabInfo)
      .finally(() => setLoading(false))
  }, [mbRecordingId])

  async function handleFileUpload(file: File) {
    const form = new FormData()
    form.append('file', file)
    setUploading(true)
    try {
      const res = await fetch(apiUrl(`/api/tab/${mbRecordingId}/upload`), { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json()
        alert(err.detail ?? 'Erreur lors de l\'upload')
        return
      }
      const data = await res.json()
      setTabInfo({ exists: true, ...data })
    } finally {
      setUploading(false)
    }
  }

  // ── Chargement ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <Skeleton className="h-4 w-48 mb-3" />
        <Skeleton className="h-10 w-40" />
      </div>
    )
  }

  // ── Pas de fichier → formulaire d'upload ────────────────────────────────────

  if (!tabInfo?.exists) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileMusic className="h-5 w-5 text-slate-400" />
          <p className="text-sm font-semibold text-slate-700">Tablature Guitar Pro</p>
        </div>

        <p className="text-sm text-slate-500">
          Aucune tablature disponible pour cette chanson.
        </p>

        <p className="text-xs text-slate-400">
          Formats acceptés : .gp, .gp3, .gp4, .gp5, .gpx
        </p>

        <label className={cn(
          'inline-flex items-center gap-2 cursor-pointer rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors',
          uploading && 'opacity-50 pointer-events-none',
        )}>
          <Upload className="h-4 w-4" />
          {uploading ? 'Import en cours…' : 'Importer une tablature'}
          <input
            type="file"
            accept=".gp,.gp3,.gp4,.gp5,.gpx"
            className="sr-only"
            onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
          />
        </label>
      </div>
    )
  }

  // ── Fichier présent → lecteur ────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Barre fichier */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/60">
        <FileMusic className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="text-xs text-slate-500 truncate flex-1">{tabInfo.filename}</span>
        <label className={cn(
          'flex items-center gap-1 cursor-pointer text-[11px] text-slate-400 hover:text-slate-600 transition-colors shrink-0',
          uploading && 'opacity-50 pointer-events-none',
        )}>
          <RefreshCw className="h-3 w-3" />
          Remplacer
          <input
            type="file" accept=".gp,.gp3,.gp4,.gp5,.gpx" className="sr-only"
            onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
          />
        </label>
      </div>

      {/* Lecteur */}
      <AlphaTabViewer
        fileUrl={tabInfo.url!}
        onTracksLoaded={() => {}}
      />
    </div>
  )
}
