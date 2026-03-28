import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg' | 'icon'
}

export function Button({ className, variant = 'default', size = 'md', ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40',
        variant === 'default' && 'bg-amber-500 text-white hover:bg-amber-600 active:bg-amber-700',
        variant === 'outline' && 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
        variant === 'ghost'  && 'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700',
        variant === 'danger' && 'bg-red-500 text-white hover:bg-red-600 active:bg-red-700',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-11 px-6 text-base',
        size === 'icon' && 'h-9 w-9',
        className,
      )}
      {...props}
    />
  )
}
