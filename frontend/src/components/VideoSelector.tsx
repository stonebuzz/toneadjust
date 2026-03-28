import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface VideoResult {
  rank: number
  title: string
  channel: string
  duration: string
  thumbnail: string
  video_url: string
}

export function VideoSelector() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const { artist, song, results } = state as { artist: string; song: string; results: VideoResult[] }
  const [selected, setSelected] = useState<VideoResult | null>(null)

  function handleAnalyze() {
    if (!selected) return
    navigate('/progress', { state: { artist, song, video_url: selected.video_url } })
  }

  return (
    <div className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Sélection</p>
          <h2 className="text-xl font-semibold text-zinc-50">
            {artist} — <span className="text-zinc-400">{song}</span>
          </h2>
          <p className="text-sm text-zinc-500">Choisissez la vidéo à utiliser pour l'analyse</p>
        </div>

        <div className="space-y-3">
          {results.map(video => (
            <Card
              key={video.rank}
              className={`cursor-pointer transition-all hover:border-zinc-600 ${
                selected?.rank === video.rank ? 'border-amber-500/60 bg-amber-500/5' : ''
              }`}
              onClick={() => setSelected(video)}
            >
              <CardContent className="flex gap-4 p-4">
                <div className="relative shrink-0">
                  <img
                    src={video.thumbnail}
                    alt=""
                    className="h-16 w-28 rounded-md object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                </div>
                <div className="flex flex-1 flex-col justify-center gap-1 min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-100">{video.title}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{video.channel}</span>
                    <span className="text-zinc-700">·</span>
                    <Badge variant="outline">{video.duration}</Badge>
                  </div>
                </div>
                {selected?.rank === video.rank && (
                  <div className="flex items-center shrink-0">
                    <div className="h-2 w-2 rounded-full bg-amber-500" />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <Button
          size="lg"
          className="w-full"
          disabled={!selected}
          onClick={handleAnalyze}
        >
          Lancer l'analyse
        </Button>
      </div>
    </div>
  )
}
