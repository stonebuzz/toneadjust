import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Database, FolderOpen, Music2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ActionCardProps {
  icon: React.ReactNode
  title: string
  description: string
  confirmText: string
  onConfirm: () => Promise<void>
}

function ActionCard({ icon, title, description, confirmText, onConfirm }: ActionCardProps) {
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading]       = useState(false)
  const [done, setDone]             = useState(false)
  const [error, setError]           = useState<string | null>(null)

  async function handleConfirm() {
    setLoading(true)
    setError(null)
    try {
      await onConfirm()
      setDone(true)
      setConfirming(false)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="text-slate-400">{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-500">{description}</p>

        {done && (
          <p className="text-sm font-medium text-emerald-600">Action effectuée avec succès.</p>
        )}
        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        {!confirming ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setDone(false); setConfirming(true) }}
          >
            {title}
          </Button>
        ) : (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <p className="text-sm text-red-700">
                <span className="font-semibold">Action irréversible.</span>{' '}
                {confirmText}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={loading}
              >
                Annuler
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading ? 'En cours…' : 'Confirmer'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AdminPage() {
  const navigate = useNavigate()

  async function clearDb() {
    const res = await fetch('/api/admin/clear-db', { method: 'POST' })
    if (!res.ok) throw new Error(`Erreur serveur : ${res.status}`)
  }

  async function clearDownloads() {
    const res = await fetch('/api/admin/clear-downloads', { method: 'POST' })
    if (!res.ok) throw new Error(`Erreur serveur : ${res.status}`)
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500">
            <Music2 className="h-4 w-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-base font-semibold tracking-tight text-slate-900">ToneAdjust</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Retour
        </Button>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-xl px-4 py-12 space-y-8">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-slate-900">Administration</h1>
          <p className="text-sm text-slate-500">
            Actions de maintenance — les tables ne sont pas supprimées, uniquement leurs données.
          </p>
        </div>

        <div className="space-y-4">
          <ActionCard
            icon={<Database className="h-4 w-4" />}
            title="Vider la base de données"
            description="Supprime toutes les chansons ainsi que les genres, labels, membres et instruments associés. Les tables sont conservées et prêtes à être remplies à nouveau."
            confirmText="Toutes les données seront supprimées définitivement."
            onConfirm={clearDb}
          />

          <ActionCard
            icon={<FolderOpen className="h-4 w-4" />}
            title="Vider les téléchargements"
            description="Supprime tous les fichiers audio et stems présents dans le dossier downloads/. Le dossier est recréé vide après l'opération."
            confirmText="Tous les fichiers audio et stems seront supprimés définitivement."
            onConfirm={clearDownloads}
          />
        </div>
      </main>
    </div>
  )
}
