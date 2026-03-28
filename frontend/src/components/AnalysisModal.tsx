import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Check, Loader2, Music2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// ── Types ──────────────────────────────────────────────────────────────────────

type StepStatus = 'pending' | 'processing' | 'done' | 'error'

export interface TrackRecord {
  id: string
  title: string
  artist: string
  album: string | null
  year: number | null
  duration_ms: number | null
  disambiguation: string | null
  thumb_url: string | null
  genres: string[]
  already_processed: boolean
}

export interface VideoResult {
  rank: number
  title: string
  channel: string
  duration: string
  thumbnail: string
  video_url: string
}

interface LogEntry {
  id: number
  time: string
  type: 'start' | 'success' | 'error' | 'log'
  step: string
  message: string
}

export interface Props {
  isOpen: boolean
  onClose: () => void
  artist: string
  song: string
  trackSearching: boolean
  trackRecordings: TrackRecord[]
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'download', label: 'Download'   },
  { key: 'demucs',   label: 'Séparation' },
  { key: 'analysis', label: 'Analyse'    },
]

const STEP_START_MSG: Record<string, string> = {
  download: "Téléchargement de l'audio depuis YouTube...",
  demucs:   'Séparation des pistes avec htdemucs_6s (peut prendre plusieurs minutes)...',
  analysis: 'Analyse spectrale de la piste guitare (librosa)...',
}

const initStatuses = (): Record<string, StepStatus> =>
  Object.fromEntries(STEPS.map(s => [s.key, 'pending']))

function ts(): string {
  return new Date().toLocaleTimeString('fr-FR', { hour12: false })
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

// ── RecordingRow sub-component (manages its own imgFailed state) ───────────────

function RecordingRow({ record, onClick }: { record: TrackRecord; onClick: () => void }) {
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <Card
      className="cursor-pointer transition-all hover:border-amber-300 hover:bg-amber-50/40 hover:shadow-sm active:scale-[0.99]"
      onClick={onClick}
    >
      <div className="flex items-center gap-3 p-3">
        {/* Thumbnail */}
        {record.thumb_url && !imgFailed ? (
          <img
            src={record.thumb_url}
            alt=""
            className="h-12 w-12 shrink-0 rounded object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-slate-100">
            <Music2 className="h-5 w-5 text-slate-400" />
          </div>
        )}

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{record.title}</p>
          <p className="truncate text-xs text-slate-500">
            {record.artist}
            {record.album && <> · {record.album}</>}
            {record.year  && <> · {record.year}</>}
            {record.duration_ms != null && <> · {formatDuration(record.duration_ms)}</>}
          </p>
          {record.disambiguation && (
            <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
              {record.disambiguation}
            </span>
          )}
        </div>

        {/* Status */}
        {record.already_processed ? (
          <Badge variant="success" className="shrink-0">Déjà analysé</Badge>
        ) : (
          <div className="shrink-0 rounded-full border border-slate-200 p-1.5">
            <Check className="h-3 w-3 text-slate-300" />
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AnalysisModal({ isOpen, onClose, artist, song, trackSearching, trackRecordings }: Props) {
  const [selectedRecord, setSelectedRecord] = useState<TrackRecord | null>(null)
  const [youtubeSearching, setYoutubeSearching] = useState(false)
  const [youtubeResults, setYoutubeResults] = useState<VideoResult[]>([])
  const [selected, setSelected] = useState<VideoResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, StepStatus>>(initStatuses)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logId = useRef(0)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const navigate = useNavigate()

  // Reset internal state each time the modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedRecord(null)
      setYoutubeSearching(false)
      setYoutubeResults([])
      setSelected(null)
      setAnalyzing(false)
      setStatuses(initStatuses())
      setLogs([])
      logId.current = 0
    }
  }, [isOpen])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  function pushLog(type: LogEntry['type'], step: string, message: string) {
    setLogs(prev => [...prev, { id: logId.current++, time: ts(), type, step, message }])
  }

  async function handleSelectRecord(record: TrackRecord) {
    if (record.already_processed) {
      navigate(`/songs/${record.id}`)
      onCloseRef.current()
      return
    }
    setSelectedRecord(record)
    setYoutubeSearching(true)
    setYoutubeResults([])

    try {
      const res = await fetch('/api/youtube-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: record.artist, song: record.title }),
      })
      const data = await res.json()
      setYoutubeResults(data.results ?? [])
    } catch {
      // fallback: empty results
    } finally {
      setYoutubeSearching(false)
    }
  }

  function handleSelectVideo(video: VideoResult) {
    setSelected(video)
    setAnalyzing(true)
  }

  // SSE pipeline — starts as soon as analyzing=true and selected + selectedRecord are set
  useEffect(() => {
    if (!analyzing || !selected || !selectedRecord) return
    const controller = new AbortController()

    async function run() {
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mb_recording_id: selectedRecord!.id,
            artist:   selectedRecord!.artist,
            song:     selectedRecord!.title,
            video_url: selected!.video_url,
            title:    selectedRecord!.title,
            album:    selectedRecord!.album,
            year:     selectedRecord!.year,
            genres:   selectedRecord!.genres ?? [],
          }),
          signal: controller.signal,
        })

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let event = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('event:')) {
              event = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              const data = JSON.parse(line.slice(5).trim())

              if (event === 'progress') {
                if (data.status === 'processing') {
                  setStatuses(prev => ({ ...prev, [data.step]: 'processing' }))
                  pushLog('start', data.step, STEP_START_MSG[data.step] ?? 'En cours...')
                } else if (data.status === 'done') {
                  setStatuses(prev => ({ ...prev, [data.step]: 'done' }))
                  pushLog('success', data.step, buildDoneMessage(data))
                }
              } else if (event === 'log') {
                pushLog('log', data.step, data.message)
              } else if (event === 'error') {
                setStatuses(prev => ({ ...prev, [data.step]: 'error' }))
                pushLog('error', data.step, data.message)
              } else if (event === 'result') {
                navigate(`/songs/${data.song.mb_recording_id}`, { state: { song: data.song } })
                onCloseRef.current()
              }
            }
          }
        }
      } catch (e: unknown) {
        if ((e as Error).name !== 'AbortError') {
          pushLog('error', '', 'Erreur de connexion au serveur.')
        }
      }
    }

    run()
    return () => controller.abort()
  }, [analyzing, selected, selectedRecord, navigate])

  if (!isOpen) return null

  // Derived display phases
  const showTrackSearch  = trackSearching
  const showTrackList    = !trackSearching && !selectedRecord && !analyzing
  const showYoutubeSearch = selectedRecord && youtubeSearching && !analyzing
  const showYoutubeList  = selectedRecord && !youtubeSearching && youtubeResults.length > 0 && !analyzing
  const showAnalyze      = analyzing

  const canClose = !analyzing

  // Header label
  const phaseLabel = showTrackSearch  ? 'Recherche MusicBrainz'
    : showTrackList    ? 'Sélection de l\'enregistrement'
    : showYoutubeSearch ? 'Recherche YouTube'
    : showYoutubeList  ? 'Sélection de la vidéo'
    : 'Pipeline en cours'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-sm"
        onClick={canClose ? onClose : undefined}
      />

      {/* Modal */}
      <div
        className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        style={{ maxHeight: 'min(90vh, 740px)' }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              {phaseLabel}
            </p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">
              {selectedRecord ? selectedRecord.artist : artist}
              {selectedRecord
                ? <span className="text-slate-400"> — {selectedRecord.title}</span>
                : song && <span className="text-slate-400"> — {song}</span>
              }
            </h2>
          </div>
          {canClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* ── Track searching ──────────────────────────────────────── */}
        {showTrackSearch && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-16">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <p className="text-sm text-slate-500">Recherche sur MusicBrainz…</p>
          </div>
        )}

        {/* ── Track list ───────────────────────────────────────────── */}
        {showTrackList && (
          <div className="flex-1 overflow-y-auto p-5 space-y-2">
            {trackRecordings.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <Music2 className="h-8 w-8 text-slate-300" />
                <p className="text-sm text-slate-500">Aucun enregistrement trouvé.</p>
              </div>
            ) : (
              <>
                <p className="pb-1 text-sm text-slate-500">
                  Cliquez sur un enregistrement pour continuer
                </p>
                {trackRecordings.map(record => (
                  <RecordingRow
                    key={record.id}
                    record={record}
                    onClick={() => handleSelectRecord(record)}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {/* ── YouTube searching ────────────────────────────────────── */}
        {showYoutubeSearch && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-16">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <p className="text-sm text-slate-500">Recherche sur YouTube…</p>
          </div>
        )}

        {/* ── YouTube list ─────────────────────────────────────────── */}
        {showYoutubeList && (
          <div className="flex-1 overflow-y-auto p-5 space-y-2">
            <p className="pb-1 text-sm text-slate-500">
              Cliquez sur une vidéo pour démarrer l'analyse
            </p>
            {youtubeResults.map(video => (
              <Card
                key={video.rank}
                className="cursor-pointer transition-all hover:border-amber-300 hover:bg-amber-50/40 hover:shadow-sm active:scale-[0.99]"
                onClick={() => handleSelectVideo(video)}
              >
                <CardContent className="flex items-center gap-3 p-3">
                  <img
                    src={video.thumbnail}
                    alt=""
                    className="h-14 w-24 shrink-0 rounded-md object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{video.title}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="truncate text-xs text-slate-500">{video.channel}</span>
                      <span className="text-slate-300">·</span>
                      <Badge variant="outline">{video.duration}</Badge>
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full border border-slate-200 p-1.5">
                    <Check className="h-3 w-3 text-slate-300" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* ── Analyze ──────────────────────────────────────────────── */}
        {showAnalyze && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Selected video recap */}
            {selected && (
              <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3">
                <img
                  src={selected.thumbnail}
                  alt=""
                  className="h-9 w-16 shrink-0 rounded object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-700">{selected.title}</p>
                  <p className="text-[11px] text-slate-400">{selected.channel} · {selected.duration}</p>
                </div>
              </div>
            )}

            {/* Horizontal steps */}
            <div className="shrink-0 border-b border-slate-100 px-8 py-5">
              <HorizontalStepper statuses={statuses} />
            </div>

            {/* Debug log */}
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-950 p-4 font-mono text-[11px] leading-relaxed">
              {logs.length === 0 && (
                <span className="text-slate-600">Initialisation du pipeline…</span>
              )}
              {logs.map(entry => <LogLine key={entry.id} entry={entry} />)}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Horizontal stepper ─────────────────────────────────────────────────────────

function HorizontalStepper({ statuses }: { statuses: Record<string, StepStatus> }) {
  return (
    <div className="flex items-center">
      {STEPS.map((step, i) => {
        const status = statuses[step.key]
        const isLast = i === STEPS.length - 1
        return (
          <Fragment key={step.key}>
            <div className="flex shrink-0 flex-col items-center gap-2">
              <StepDot status={status} />
              <span className={`text-[11px] font-medium ${
                status === 'done'       ? 'text-emerald-600' :
                status === 'processing' ? 'text-amber-600'   :
                status === 'error'      ? 'text-red-500'     :
                                          'text-slate-400'
              }`}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div className={`mb-5 h-px flex-1 mx-3 transition-colors ${
                status === 'done' ? 'bg-emerald-300' : 'bg-slate-200'
              }`} />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

function StepDot({ status }: { status: StepStatus }) {
  if (status === 'done') return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-300 bg-emerald-100">
      <Check className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
    </div>
  )
  if (status === 'processing') return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-300 bg-amber-100">
      <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
    </div>
  )
  if (status === 'error') return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-red-300 bg-red-100">
      <AlertCircle className="h-4 w-4 text-red-500" />
    </div>
  )
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-100">
      <div className="h-2 w-2 rounded-full bg-slate-300" />
    </div>
  )
}

// ── Log line ───────────────────────────────────────────────────────────────────

function LogLine({ entry }: { entry: LogEntry }) {
  const { time, type, step, message } = entry

  if (type === 'log') {
    return (
      <div className="flex gap-2 py-px opacity-60">
        <span className="shrink-0 tabular-nums text-slate-600">{time}</span>
        <span className="w-16 shrink-0 truncate text-slate-600">{step}</span>
        <span className="shrink-0 text-slate-600">·</span>
        <span className="text-slate-400">{message}</span>
      </div>
    )
  }

  const prefix      = type === 'start' ? '→' : type === 'success' ? '✓' : '✗'
  const prefixColor = type === 'start' ? 'text-amber-400' : type === 'success' ? 'text-emerald-400' : 'text-red-400'
  const msgColor    = type === 'start' ? 'text-slate-300' : type === 'success' ? 'text-slate-100'   : 'text-red-300'

  return (
    <div className="flex gap-2 py-px">
      <span className="shrink-0 tabular-nums text-slate-600">{time}</span>
      <span className="w-16 shrink-0 truncate text-slate-500">{step}</span>
      <span className={`shrink-0 ${prefixColor}`}>{prefix}</span>
      <span className={msgColor}>{message}</span>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildDoneMessage(data: Record<string, unknown>): string {
  const step = data.step as string
  if (step === 'download') {
    const p = (data.audio_path as string | undefined) ?? ''
    return `Audio : ${p.split('/').pop() ?? p}`
  }
  if (step === 'demucs') {
    const stems = Object.keys((data.stems as Record<string, unknown>) ?? {}).join(', ')
    return `Stems : ${stems}`
  }
  if (step === 'analysis') {
    const a = (data.analysis as Record<string, number>) ?? {}
    return [
      a.spectral_centroid != null && `Centroïde : ${Math.round(a.spectral_centroid)} Hz`,
      a.rms_energy        != null && `RMS : ${a.rms_energy.toFixed(3)}`,
      a.hnr               != null && `HNR : ${a.hnr.toFixed(2)}`,
      a.rt60              != null && `RT60 : ${a.rt60.toFixed(2)} s`,
    ].filter(Boolean).join('  ·  ')
  }
  return 'Terminé'
}
