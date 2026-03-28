/**
 * Base URL de l'API backend.
 * En dev : vide → proxy Vite vers localhost:8000
 * En prod : VITE_API_BASE_URL (ex: https://toneadjust-api.onrender.com)
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}
