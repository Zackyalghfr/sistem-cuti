import { getServerSession } from 'next-auth'
import { authOptions } from '@/backend/auth'
import { prisma } from '@/backend/prisma'
import { runFlow } from '@/backend/workflow-engine'

const VALID_JENIS_CUTI = ['TAHUNAN', 'SAKIT', 'MELAHIRKAN', 'KELUARGA', 'BESAR']

function hitungHariKerja(startDate, endDate) {
  let count = 0
  const cur = new Date(startDate)
  while (cur <= endDate) {
    const day = cur.getDay()
    if (day !== 0 && day !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const where = session.user.role === 'GURU'
    ? { guruId: session.user.id }
    : {}

  const pengajuan = await prisma.pengajuanCuti.findMany({
    where,
    include: {
      guru: { select: { nama: true, mapel: true, email: true } }
    },
    orderBy: { createdAt: 'desc' }
  })

  return Response.json(pengajuan)
}

export async function POST(req) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'GURU') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { jenisCuti, tanggalMulai, tanggalSelesai, alasan, penggantiNama } = body

  if (!jenisCuti || !tanggalMulai || !tanggalSelesai || !alasan?.trim()) {
    return Response.json({ error: 'Data formulir tidak lengkap' }, { status: 400 })
  }

  if (!VALID_JENIS_CUTI.includes(jenisCuti)) {
    return Response.json({ error: 'Jenis cuti tidak valid' }, { status: 400 })
  }

  const startDate = new Date(tanggalMulai)
  const endDate = new Date(tanggalSelesai)

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return Response.json({ error: 'Format tanggal tidak valid' }, { status: 400 })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (startDate < today) {
    return Response.json({ error: 'Tanggal mulai tidak boleh di masa lalu' }, { status: 400 })
  }

  if (endDate < startDate) {
    return Response.json({ error: 'Tanggal selesai tidak boleh sebelum tanggal mulai' }, { status: 400 })
  }

  const jumlahHari = hitungHariKerja(startDate, endDate)
  if (jumlahHari <= 0) {
    return Response.json({ error: 'Tanggal yang dipilih tidak mengandung hari kerja (hanya Sabtu/Minggu)' }, { status: 400 })
  }

  try {
    const result = await runFlow('flow-pengajuan', {
      guruId: session.user.id,
      jenisCuti,
      tanggalMulai,
      tanggalSelesai,
      jumlahHari,
      alasan: alasan.trim(),
      penggantiNama: penggantiNama?.trim() || null,
    })
    return Response.json(result)
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 })
  }
}
