import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'

type StepStatus = 'pending' | 'processing' | 'done' | 'error'

interface Step {
  key: string
  label: string
  description: string
}

const STEPS: Step[] = [
  { key: 'download', label: 'Téléchargement', description: 'Récupération de l\'audio depuis YouTube' },
  { key: 'metadata', label: 'Métadonnées', description: 'Titre, album, année, BPM' },
  { key: 'demucs', label: 'Séparation des pistes', description: 'Isolation guitare, basse, voix, batterie' },
  { key: 'analysis', label: 'Analyse guitare', description: 'Caractéristiques spectrales et tonales' },
]

export function ProgressSteps() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const { artist, song, video_url } = state as { artist: string; song: string; video_url: string }

  const [statuses, setStatuses] = useState<Record<string, StepStatus>>(
    Object.fromEntries(STEPS.map(s => [s.key, 'pending']))
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function run() {
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artist, song, video_url }),
          signal: controller.signal,
        })

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          let event = ''
          for (const line of lines) {
            if (line.startsWith('event:')) {
              event = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              const data = JSON.parse(line.slice(5).trim())
              if (event === 'progress') {
                setStatuses(prev => ({ ...prev, [data.step]: data.status as StepStatus }))
              } else if (event === 'error') {
                setStatuses(prev => ({ ...prev, [data.step]: 'error' }))
                setError(data.message)
                return
              } else if (event === 'result') {
                navigate(`/songs/${encodeURIComponent(artist)}/${encodeURIComponent(song)}`, {
                  state: { song: data.song },
                })
              }
            }
          }
        }
      } catch (e: unknown) {
        if ((e as Error).name !== 'AbortError') {
          setError('Erreur de connexion au serveur.')
        }
      }
    }

    run()
    return () => controller.abort()
  }, [artist, song, video_url, navigate])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-1 text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Analyse en cours</p>
          <h2 className="text-xl font-semibold text-zinc-50">{artist} — {song}</h2>
        </div>

        <div className="space-y-1">
          {STEPS.map((step, i) => {
            const status = statuses[step.key]
            return (
              <div key={step.key} className="flex items-start gap-4 rounded-lg p-4">
                <div className="relative flex flex-col items-center">
                  <StepIcon status={status} />
                  {i < STEPS.length - 1 && (
                    <div className={`mt-1 h-8 w-px ${status === 'done' ? 'bg-emerald-500/40' : 'bg-zinc-800'}`} />
                  )}
                </div>
                <div className="flex-1 pt-0.5 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${status === 'pending' ? 'text-zinc-500' : 'text-zinc-100'}`}>
                      {step.label}
                    </span>
                    <StatusBadge status={status} />
                  </div>
                  <p className="text-xs text-zinc-600">{step.description}</p>
                </div>
              </div>
            )
          })}
        </div>

        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/40">
        <svg className="h-3 w-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    )
  }
  if (status === 'processing') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 ring-1 ring-amber-500/40">
        <div className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20 ring-1 ring-red-500/40">
        <div className="h-2 w-2 rounded-full bg-red-400" />
      </div>
    )
  }
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-zinc-700">
      <div className="h-2 w-2 rounded-full bg-zinc-600" />
    </div>
  )
}

function StatusBadge({ status }: { status: StepStatus }) {
  if (status === 'done') return <Badge variant="success">Terminé</Badge>
  if (status === 'processing') return <Badge variant="amber">En cours…</Badge>
  if (status === 'error') return <Badge className="bg-red-500/10 text-red-400 ring-red-500/30">Erreur</Badge>
  return null
}
