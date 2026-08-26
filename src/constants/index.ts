import { Significance } from '../types'

export const SPEAKER_COLORS = [
  { chip: 'bg-blue-50 text-blue-700 border border-blue-200', dot: 'bg-blue-500', stripeColor: '#60a5fa' },
  { chip: 'bg-violet-50 text-violet-700 border border-violet-200', dot: 'bg-violet-500', stripeColor: '#a78bfa' },
  { chip: 'bg-cyan-50 text-cyan-700 border border-cyan-200', dot: 'bg-cyan-500', stripeColor: '#22d3ee' },
  { chip: 'bg-emerald-50 text-emerald-700 border border-emerald-200', dot: 'bg-emerald-500', stripeColor: '#34d399' },
  { chip: 'bg-orange-50 text-orange-700 border border-orange-200', dot: 'bg-orange-500', stripeColor: '#fb923c' },
]

export const SIG_CONFIG: Record<Significance, { label: string; badge: string; dot: string }> = {
  none: { label: 'None', badge: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400' },
  low: { label: 'Low', badge: 'bg-blue-50 text-blue-600', dot: 'bg-blue-400' },
  medium: { label: 'Medium', badge: 'bg-amber-50 text-amber-600', dot: 'bg-amber-400' },
  high: { label: 'High', badge: 'bg-red-50 text-red-600', dot: 'bg-red-500' },
}
