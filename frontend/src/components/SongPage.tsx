import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  Maximize2, Music2, Settings,
  Play, Pause, Volume2, Guitar, Mic2, Drum,
  Headphones, BarChart2, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiUrl } from '@/lib/api'
import { GuitarProPlayer } from '@/components/GuitarProPlayer'

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface GuitarAnalysis {
  duration: number
  sample_rate: number
  key: string
  chroma: number[]
  tempo: number
  onset_rate: number
  spectral_centroid: number
  spectral_bandwidth: number
  spectral_rolloff: number
  spectral_flatness: number
  spectral_contrast: number[]
  mfcc: number[]
  rms_energy: number
  rms_db: number
  peak_amplitude: number
  crest_factor: number
  dynamic_range_db: number
  zero_crossing_rate: number
  hnr: number
  rt60: number
  delay_time: number
}

interface Member {
  name: string
  instruments: string[]
}

interface SongData {
  id: number
  artist: string
  song: string
  artist_name: string | null
  youtube_url: string
  title: string | null
  year: number | null
  album: string | null
  bpm: number | null
  audio_path: string
  stems_dir: string
  analysis: GuitarAnalysis | null
  genres: string[]
  labels: string[]
  members: Member[]
  mb_recording_id: string | null
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STEM_LABELS: Record<string, string> = {
  guitar: 'Guitare',
  bass: 'Basse',
  vocals: 'Voix',
  drums: 'Batterie',
  other: 'Autre',
}

const STEM_ICONS: Record<string, React.ElementType> = {
  guitar: Guitar,
  bass: Guitar,
  vocals: Mic2,
  drums: Drum,
  other: Music2,
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalize(value: number, min: number, max: number) {
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
}

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

// ── WaveformCanvas ─────────────────────────────────────────────────────────────

function WaveformCanvas({ analyser, currentTime, duration, onSeek }: {
  analyser: AnalyserNode | null
  currentTime: number
  duration: number
  onSeek: (t: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const ctRef = useRef(currentTime)
  const durRef = useRef(duration)
  useEffect(() => { ctRef.current = currentTime }, [currentTime])
  useEffect(() => { durRef.current = duration }, [duration])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    function drawFlat() {
      const W = canvas!.width, H = canvas!.height
      ctx.clearRect(0, 0, W, H)
      ctx.beginPath()
      ctx.strokeStyle = '#cbd5e1'
      ctx.lineWidth = 1
      ctx.moveTo(0, H / 2)
      ctx.lineTo(W, H / 2)
      ctx.stroke()
    }

    if (!analyser) { drawFlat(); return }

    const bufferLength = analyser.fftSize
    const dataArray = new Uint8Array(bufferLength)

    function draw() {
      rafRef.current = requestAnimationFrame(draw)
      analyser!.getByteTimeDomainData(dataArray)
      const W = canvas!.width, H = canvas!.height
      ctx.clearRect(0, 0, W, H)
      ctx.beginPath()
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      const slice = W / bufferLength
      let x = 0
      for (let i = 0; i < bufferLength; i++) {
        const y = (dataArray[i] / 128.0) * (H / 2)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        x += slice
      }
      ctx.stroke()
      const ct = ctRef.current, dur = durRef.current
      if (dur > 0) {
        const px = (ct / dur) * W
        ctx.beginPath()
        ctx.strokeStyle = 'rgba(51,65,85,0.5)'
        ctx.lineWidth = 1.5
        ctx.moveTo(px, 0)
        ctx.lineTo(px, H)
        ctx.stroke()
      }
    }

    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyser])

  return (
    <div className="relative flex-1 min-w-0 h-8">
      <canvas
        ref={canvasRef}
        width={800}
        height={32}
        className="block w-full h-full rounded"
        style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
      />
      <input
        type="range" min={0} max={duration || 1} step={0.1} value={currentTime}
        onChange={e => onSeek(Number(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </div>
  )
}

// ── StemPlayer ─────────────────────────────────────────────────────────────────

const StemPlayer = forwardRef<
  { togglePlay: () => void },
  { stemsBase: string; onPlayingChange?: (playing: boolean) => void }
>(function StemPlayer({ stemsBase, onPlayingChange }, ref) {
  const keys = Object.keys(STEM_LABELS)
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const rafRef = useRef<number>(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceCreated = useRef<Set<string>>(new Set())

  const [isPlaying, setIsPlaying] = useState(false)
  const [playingTrack, setPlayingTrack] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loadedCount, setLoadedCount] = useState(0)
  const [muted, setMuted] = useState<Record<string, boolean>>({})
  const [soloed, setSoloed] = useState<string | null>(null)
  const [globalVolume, setGlobalVolume] = useState(0.5)
  const [volumes, setVolumes] = useState<Record<string, number>>(
    () => Object.fromEntries(keys.map(k => [k, 0.5]))
  )
  const [analyserMap, setAnalyserMap] = useState<Record<string, AnalyserNode | null>>({})

  function ensureAudioContext() {
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
      return
    }
    const actx = new AudioContext()
    audioCtxRef.current = actx
    const newMap: Record<string, AnalyserNode | null> = {}
    keys.forEach(key => {
      const el = audioRefs.current[key]
      if (!el || sourceCreated.current.has(key)) return
      try {
        const src = actx.createMediaElementSource(el)
        const analyser = actx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.85
        src.connect(analyser)
        analyser.connect(actx.destination)
        newMap[key] = analyser
        sourceCreated.current.add(key)
      } catch { /* ignore */ }
    })
    setAnalyserMap(newMap)
  }

  function isAudible(key: string) {
    if (soloed !== null) return key === soloed
    return !muted[key]
  }

  function startRaf() {
    function tick() {
      const first = audioRefs.current[keys[0]]
      if (first) setCurrentTime(first.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function stopRaf() { cancelAnimationFrame(rafRef.current) }

  function setPlaying(v: boolean) {
    setIsPlaying(v)
    onPlayingChange?.(v)
  }

  function handleGlobalPlay() {
    ensureAudioContext()
    if (isPlaying) {
      keys.forEach(k => audioRefs.current[k]?.pause())
      stopRaf(); setPlaying(false); setPlayingTrack(null)
    } else {
      Promise.allSettled(
        keys.filter(k => isAudible(k)).map(k => audioRefs.current[k]?.play())
      ).then(() => {
        const t = audioRefs.current[keys[0]]?.currentTime ?? 0
        keys.forEach(k => { const el = audioRefs.current[k]; if (el) el.currentTime = t })
      })
      startRaf(); setPlaying(true); setPlayingTrack(null)
    }
  }

  function handleTrackPlay(key: string) {
    ensureAudioContext()
    const el = audioRefs.current[key]; if (!el) return
    if (playingTrack === key) {
      el.pause(); stopRaf(); setPlayingTrack(null); setPlaying(false)
    } else {
      keys.forEach(k => audioRefs.current[k]?.pause())
      stopRaf(); setPlaying(false)
      const t = audioRefs.current[keys[0]]?.currentTime ?? 0
      el.currentTime = t
      el.play().then(() => { startRaf(); setPlayingTrack(key) })
    }
  }

  function handleSeek(time: number) {
    keys.forEach(k => { const el = audioRefs.current[k]; if (el) el.currentTime = time })
    setCurrentTime(time)
  }

  function handleMute(key: string) {
    if (soloed === key) setSoloed(null)
    setMuted(prev => {
      const next = { ...prev, [key]: !prev[key] }
      const el = audioRefs.current[key]; if (el) el.muted = next[key]
      return next
    })
  }

  function handleSolo(key: string) {
    setSoloed(prev => {
      const next = prev === key ? null : key
      keys.forEach(k => {
        const el = audioRefs.current[k]; if (!el) return
        el.muted = next === null ? !!muted[k] : k !== next
      })
      return next
    })
  }

  function handleGlobalVolume(v: number) {
    setGlobalVolume(v)
    keys.forEach(k => { const el = audioRefs.current[k]; if (el) el.volume = v * (volumes[k] ?? 1) })
  }

  function handleTrackVolume(key: string, v: number) {
    setVolumes(prev => {
      const next = { ...prev, [key]: v }
      const el = audioRefs.current[key]; if (el) el.volume = globalVolume * v
      return next
    })
  }

  const handleGlobalPlayRef = useRef(handleGlobalPlay)
  useEffect(() => { handleGlobalPlayRef.current = handleGlobalPlay })
  useImperativeHandle(ref, () => ({ togglePlay: () => handleGlobalPlayRef.current() }), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.code === 'Space') { e.preventDefault(); handleGlobalPlay() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); stopRaf() }
  }, [isPlaying])

  useEffect(() => () => { audioCtxRef.current?.close() }, [])

  return (
    <div>
      {keys.map(key => (
        <audio
          key={key}
          ref={el => { audioRefs.current[key] = el }}
          src={`${stemsBase}/${key}.wav`}
          preload="metadata"
          onLoadedMetadata={() => {
            setLoadedCount(c => c + 1)
            if (key === keys[0]) { const el = audioRefs.current[key]; if (el) setDuration(el.duration) }
          }}
          onEnded={() => {
            stopRaf(); setPlaying(false); setPlayingTrack(null); setCurrentTime(0)
            keys.forEach(k => { const el = audioRefs.current[k]; if (el) el.currentTime = 0 })
          }}
        />
      ))}

      {/* Contrôles globaux */}
      <div className="flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1.5 mb-3">
        <button
          onClick={handleGlobalPlay}
          disabled={loadedCount < keys.length}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 transition-colors"
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <span className="text-xs font-mono text-slate-500 shrink-0 w-20 text-center">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <input
          type="range" min={0} max={duration || 1} step={0.1} value={currentTime}
          onChange={e => handleSeek(Number(e.target.value))}
          className="flex-1 h-1.5 cursor-pointer" style={{ accentColor: '#f59e0b' }}
        />
        <div className="flex items-center gap-1.5 shrink-0 border-l border-slate-300 pl-2 ml-1">
          <Volume2 className="h-3.5 w-3.5 text-slate-400" />
          <input
            type="range" min={0} max={1} step={0.01} value={globalVolume}
            onChange={e => handleGlobalVolume(Number(e.target.value))}
            className="w-20 h-1.5 cursor-pointer" style={{ accentColor: '#f59e0b' }}
          />
          <span className="text-[10px] font-mono text-slate-400 w-7 text-right">
            {Math.round(globalVolume * 100)}%
          </span>
        </div>
      </div>

      {/* Pistes */}
      {Object.entries(STEM_LABELS).map(([key, label]) => {
        const Icon = STEM_ICONS[key] ?? Music2
        const showPause = (isPlaying && isAudible(key)) || playingTrack === key
        return (
          <div key={key} className="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
            <Icon className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="text-xs font-medium text-slate-600 w-14 shrink-0">{label}</span>
            <button
              onClick={() => handleTrackPlay(key)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
            >
              {showPause ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
            <WaveformCanvas
              analyser={analyserMap[key] ?? null}
              currentTime={currentTime}
              duration={duration}
              onSeek={handleSeek}
            />
            <button
              onClick={() => handleMute(key)}
              className={cn('h-5 px-1.5 rounded text-[10px] font-bold shrink-0 transition-colors',
                muted[key] ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              )}
            >M</button>
            <button
              onClick={() => handleSolo(key)}
              className={cn('h-5 px-1.5 rounded text-[10px] font-bold shrink-0 transition-colors',
                soloed === key ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              )}
            >S</button>
            <Volume2 className="h-3.5 w-3.5 shrink-0 text-slate-300" />
            <input
              type="range" min={0} max={1} step={0.01} value={volumes[key] ?? 0.5}
              onChange={e => handleTrackVolume(key, Number(e.target.value))}
              className="w-16 h-1 cursor-pointer shrink-0" style={{ accentColor: '#94a3b8' }}
            />
          </div>
        )
      })}
    </div>
  )
})
StemPlayer.displayName = 'StemPlayer'

// ── AnalysisBar ────────────────────────────────────────────────────────────────

function AnalysisBar({ label, value, percent, unit = '' }: {
  label: string; value: number; percent: number; unit?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-xs font-mono text-slate-700">{value.toFixed(1)}{unit}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-200">
        <div className="h-1.5 rounded-full bg-amber-500/80 transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

// ── AnalysisContent ────────────────────────────────────────────────────────────

function AnalysisContent({ analysis }: { analysis: GuitarAnalysis }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {analysis.key && (
          <div className="rounded-lg bg-slate-100 px-3 py-1.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Tonalité</p>
            <p className="text-base font-bold text-amber-600">{analysis.key}</p>
          </div>
        )}
        {analysis.tempo > 0 && (
          <div className="rounded-lg bg-slate-100 px-3 py-1.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Tempo</p>
            <p className="text-base font-bold text-slate-800">{Math.round(analysis.tempo)} <span className="text-[10px] text-slate-400">BPM</span></p>
          </div>
        )}
        {analysis.duration > 0 && (
          <div className="rounded-lg bg-slate-100 px-3 py-1.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Durée</p>
            <p className="text-base font-bold text-slate-800">
              {Math.floor(analysis.duration / 60)}:{String(Math.floor(analysis.duration % 60)).padStart(2, '0')}
            </p>
          </div>
        )}
        {analysis.sample_rate > 0 && (
          <div className="rounded-lg bg-slate-100 px-3 py-1.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Sample rate</p>
            <p className="text-base font-bold text-slate-800">{(analysis.sample_rate / 1000).toFixed(1)} <span className="text-[10px] text-slate-400">kHz</span></p>
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Spectre</p>
        <div className="space-y-3">
          <AnalysisBar label="Brillance (centroïde)" value={analysis.spectral_centroid} percent={normalize(analysis.spectral_centroid, 500, 8000)} unit=" Hz" />
          <AnalysisBar label="Présence aigus (rolloff)" value={analysis.spectral_rolloff} percent={normalize(analysis.spectral_rolloff, 1000, 16000)} unit=" Hz" />
          <AnalysisBar label="Largeur spectrale" value={analysis.spectral_bandwidth} percent={normalize(analysis.spectral_bandwidth, 500, 5000)} unit=" Hz" />
          <AnalysisBar label="Planéité" value={analysis.spectral_flatness} percent={normalize(analysis.spectral_flatness, 0, 1)} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Dynamique</p>
        <div className="space-y-3">
          <AnalysisBar label="Niveau RMS" value={analysis.rms_db} percent={normalize(analysis.rms_db, -60, 0)} unit=" dB" />
          <AnalysisBar label="Amplitude crête" value={analysis.peak_amplitude} percent={normalize(analysis.peak_amplitude, 0, 1)} />
          <AnalysisBar label="Facteur de crête" value={analysis.crest_factor} percent={normalize(analysis.crest_factor, 1, 20)} />
          <AnalysisBar label="Plage dynamique" value={analysis.dynamic_range_db} percent={normalize(analysis.dynamic_range_db, 0, 60)} unit=" dB" />
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Tonalité & effets</p>
        <div className="space-y-3">
          <AnalysisBar label="Distorsion (HNR)" value={analysis.hnr} percent={normalize(analysis.hnr, -10, 30)} unit=" dB" />
          <AnalysisBar label="Taux de passage à zéro" value={analysis.zero_crossing_rate} percent={normalize(analysis.zero_crossing_rate, 0, 0.5)} />
          <AnalysisBar label="Reverb (RT60)" value={analysis.rt60} percent={normalize(analysis.rt60, 0, 3)} unit=" s" />
          <AnalysisBar label="Delay estimé" value={analysis.delay_time * 1000} percent={normalize(analysis.delay_time, 0, 0.8)} unit=" ms" />
        </div>
      </div>
    </div>
  )
}

// ── Modal ──────────────────────────────────────────────────────────────────────

function Modal({ title, icon: Icon, onClose, children, wide, hidden = false }: {
  title: string
  icon: React.ElementType
  onClose: () => void
  children: React.ReactNode
  wide?: '2xl' | '3xl' | '4xl'
  hidden?: boolean
}) {
  const maxW = wide === '4xl' ? 'max-w-4xl' : wide === '3xl' ? 'max-w-3xl' : wide === '2xl' ? 'max-w-2xl' : 'max-w-md'
  return (
    <div
      className={cn('fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4', hidden && 'hidden')}
      onClick={onClose}
    >
      <div
        className={cn('relative flex flex-col bg-white rounded-xl shadow-xl border border-slate-200 max-h-[85vh] w-full', maxW)}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

// ── TopBar ─────────────────────────────────────────────────────────────────────

function TopBar({ navigate }: { navigate: (to: string) => void }) {
  function handleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 shadow-sm">
      <div className="flex cursor-pointer items-center gap-2.5" onClick={() => navigate('/')}>
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
  )
}

// ── SongPage ───────────────────────────────────────────────────────────────────

export function SongPage() {
  const { mb_recording_id } = useParams()
  const { state } = useLocation()
  const navigate = useNavigate()
  const [data, setData] = useState<SongData | null>(state?.song ?? null)
  const [loading, setLoading] = useState(!state?.song)
  const [showStems, setShowStems] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [isStemsPlaying, setIsStemsPlaying] = useState(false)
  const stemPlayerRef = useRef<{ togglePlay: () => void } | null>(null)

  useEffect(() => {
    if (data) return
    async function load() {
      try {
        const res = await fetch(apiUrl(`/api/songs/${mb_recording_id}`))
        const json = await res.json()
        if (json.song) setData(json.song)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [mb_recording_id, data])

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <TopBar navigate={navigate} />
        <div className="mx-auto w-full max-w-2xl space-y-4 px-8 py-12">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <TopBar navigate={navigate} />
        <div className="flex flex-1 items-center justify-center">
          <div className="space-y-4 text-center">
            <p className="text-slate-500">Chanson introuvable.</p>
            <Button variant="outline" onClick={() => navigate('/')}>Retour</Button>
          </div>
        </div>
      </div>
    )
  }

  const analysis = data.analysis
  const stemsBase = data.stems_dir ? `/audio/${data.stems_dir.split('downloads/')[1]}` : null

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">

      {/* Modales */}
      {stemsBase && (
        <Modal
          title="Pistes audio"
          icon={Headphones}
          onClose={() => setShowStems(false)}
          wide="3xl"
          hidden={!showStems}
        >
          <StemPlayer ref={stemPlayerRef} stemsBase={stemsBase} onPlayingChange={setIsStemsPlaying} />
        </Modal>
      )}
      {showAnalysis && analysis && (
        <Modal title="Analyse de la guitare" icon={BarChart2} onClose={() => setShowAnalysis(false)}>
          <AnalysisContent analysis={analysis} />
        </Modal>
      )}

      <TopBar navigate={navigate} />

      {/* Boutons flottants */}
      <div className="fixed top-[4.5rem] right-4 z-40 flex flex-col gap-2">
        {stemsBase && (
          <button
            onClick={() => setShowStems(true)}
            className={cn(
              'flex items-center gap-2 rounded-full border shadow-md px-4 py-2 text-sm font-medium transition-all hover:shadow-lg',
              isStemsPlaying
                ? 'bg-amber-500 border-amber-500 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            )}
          >
            {isStemsPlaying ? (
              <>
                <span className="flex gap-0.5 items-end h-4">
                  <span className="w-0.5 bg-white rounded-full" style={{ height: '40%', animation: 'soundbar 0.6s ease-in-out infinite alternate' }} />
                  <span className="w-0.5 bg-white rounded-full" style={{ height: '100%', animation: 'soundbar 0.6s ease-in-out 0.2s infinite alternate' }} />
                  <span className="w-0.5 bg-white rounded-full" style={{ height: '60%', animation: 'soundbar 0.6s ease-in-out 0.1s infinite alternate' }} />
                </span>
                Pistes
              </>
            ) : (
              <>
                <Headphones className="h-4 w-4 text-amber-500" />
                Pistes
              </>
            )}
          </button>
        )}
        {analysis && (
          <button
            onClick={() => setShowAnalysis(true)}
            className="flex items-center gap-2 rounded-full bg-white border border-slate-200 shadow-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:shadow-lg transition-all"
          >
            <BarChart2 className="h-4 w-4 text-amber-500" />
            Analyse
          </button>
        )}
      </div>

      {/* Contenu */}
      <div className="mx-auto w-full max-w-2xl px-8 py-10 space-y-6">
        <button
          onClick={() => navigate('/')}
          className="text-xs text-slate-400 transition-colors hover:text-slate-600"
        >
          ← Nouvelle recherche
        </button>

        <div className="space-y-1.5">
          <h1 className="text-3xl font-bold text-slate-900">{data.title ?? data.song}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="font-medium text-slate-700">{data.artist_name ?? data.artist}</span>
            {data.album && (<><span className="text-slate-300">·</span><span>{data.album}</span></>)}
            {data.year && (<><span className="text-slate-300">·</span><span>{data.year}</span></>)}
          </div>
        </div>

        {data.genres?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {data.genres.map(g => <Badge key={g} variant="muted">{g}</Badge>)}
          </div>
        )}

        {data.members?.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Membres</p>
            <div className="space-y-1">
              {data.members.map(m => (
                <div key={m.name} className="flex items-baseline gap-2">
                  <span className="text-sm text-slate-700">{m.name}</span>
                  {m.instruments.length > 0 && (
                    <span className="text-xs text-slate-400">{m.instruments.join(', ')}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.labels?.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Labels</p>
            <div className="flex flex-wrap gap-1.5">
              {data.labels.map(l => <Badge key={l} variant="outline">{l}</Badge>)}
            </div>
          </div>
        )}
      </div>

      {/* Tablature Guitar Pro */}
      {data.mb_recording_id && (
        <div className="w-[70%] mx-auto pb-12">
          <GuitarProPlayer mbRecordingId={data.mb_recording_id} />
        </div>
      )}
    </div>
  )
}
