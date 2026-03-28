import { cn } from '@/lib/utils'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'outline' | 'amber' | 'success' | 'muted' | 'zinc'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        variant === 'default' && 'bg-slate-100 text-slate-700 ring-slate-200',
        variant === 'outline' && 'bg-transparent text-slate-500 ring-slate-300',
        variant === 'amber' && 'bg-amber-50 text-amber-600 ring-amber-200',
        variant === 'success' && 'bg-emerald-50 text-emerald-600 ring-emerald-200',
        variant === 'muted' && 'bg-slate-50 text-slate-400 ring-slate-200',
        variant === 'zinc' && 'bg-zinc-800 text-zinc-300 ring-zinc-700',
        className,
      )}
      {...props}
    />
  )
}
