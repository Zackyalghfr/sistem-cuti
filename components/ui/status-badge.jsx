// components/ui/status-badge.jsx
const AVATAR_COLORS = [
  'bg-pink-100 text-pink-700',
  'bg-blue-100 text-blue-700',
  'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
]

export function AvatarChip({ nama, index = 0 }) {
  return (
    <div className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${AVATAR_COLORS[index % AVATAR_COLORS.length]}`}>
      {nama?.charAt(0) ?? '?'}
    </div>
  )
}

export function StatusBadge({ status }) {
  const map = {
    PENDING: 'bg-amber-100 text-amber-700',
    APPROVED: 'bg-green-100 text-green-700',
    REJECTED: 'bg-red-100 text-red-700',
  }
  const label = { PENDING: 'Menunggu', APPROVED: 'Disetujui', REJECTED: 'Ditolak' }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${map[status]}`}>
      {label[status]}
    </span>
  )
}