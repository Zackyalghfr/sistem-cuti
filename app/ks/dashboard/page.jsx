'use client'

import { useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock3, CheckCircle2, XCircle, ListChecks, Bell, LogOut } from 'lucide-react'
import { AvatarChip, StatusBadge } from '@/components/ui/status-badge'
import { ConfirmModal } from '@/components/ui/confirm-modal'

function formatTgl(date) {
  return new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function KsDashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [pengajuan, setPengajuan] = useState([])
  const [notifikasi, setNotifikasi] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // { id, action: 'approve'|'reject' }
  const [catatan, setCatatan] = useState('')
  const [processing, setProcessing] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
    if (status === 'authenticated') {
      if (session.user.role !== 'KEPALA_SEKOLAH') router.push('/guru/dashboard')
      else fetchData()
    }
  }, [status])

  async function fetchData() {
    try {
      const [pengajuanRes, notifRes] = await Promise.all([
        fetch('/api/cuti'),
        fetch('/api/notifikasi'),
      ])
      setPengajuan(await pengajuanRes.json())
      setNotifikasi(await notifRes.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleKeputusan() {
    if (!modal) return
    if (modal.action === 'reject' && !catatan) {
      alert('Alasan penolakan wajib diisi')
      return
    }

    setProcessing(true)
    try {
      const endpoint = modal.action === 'approve'
        ? `/api/cuti/${modal.id}/approve`
        : `/api/cuti/${modal.id}/reject`

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catatan }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setToast(modal.action === 'approve' ? 'Cuti berhasil disetujui! Email & surat dikirim otomatis.' : 'Pengajuan berhasil ditolak.')
      setTimeout(() => setToast(''), 4000)
      setModal(null)
      setCatatan('')
      fetchData()
    } catch (err) {
      alert(err.message)
    } finally {
      setProcessing(false)
    }
  }

  if (status === 'loading' || loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-500">Memuat data...</p>
    </div>
  )

  const pending = pengajuan.filter(p => p.status === 'PENDING')
  const riwayat = pengajuan.filter(p => p.status !== 'PENDING')
  const disetujuiBulanIni = riwayat.filter(p => {
    return p.status === 'APPROVED' && new Date(p.approvedAt).getMonth() === new Date().getMonth()
  }).length
  const ditolakBulanIni = riwayat.filter(p => {
    return p.status === 'REJECTED' && new Date(p.approvedAt).getMonth() === new Date().getMonth()
  }).length

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Toast */}
      {toast && (
        <div className="fixed top-5 right-5 z-[1000] max-w-[360px] rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-[13px] font-medium text-green-600 shadow-sm">
          ✓ {toast}
        </div>
      )}

      <ConfirmModal
        modal={modal}
        catatan={catatan}
        setCatatan={setCatatan}
        processing={processing}
        onClose={() => { setModal(null); setCatatan('') }}
        onConfirm={handleKeputusan}
      />

      {/* Top bar */}
      <nav className="flex items-center justify-between border-b border-gray-100 bg-white px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-gray-900 text-sm font-bold text-white">S</div>
          <span className="text-[15px] font-semibold text-gray-900">SiCuti</span>
        </div>
        <div className="flex items-center gap-4">
          <button className="text-gray-400 hover:text-gray-600">
            <Bell size={18} />
          </button>
          <div className="flex size-8 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700">
            {session?.user?.nama?.charAt(0)}
          </div>
          <button
            onClick={() => import('next-auth/react').then(m => m.signOut({ callbackUrl: '/login' }))}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <LogOut size={14} /> Keluar
          </button>
        </div>
      </nav>

      {/* Content */}
      <div className="mx-auto max-w-[1100px] p-6">

        {/* Greeting */}
        <div className="mb-5">
          <p className="mb-1 text-xs text-gray-500">
            {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <h2 className="text-2xl font-bold text-gray-900">
            Selamat datang, {session?.user?.nama ?? 'Kepala Sekolah'}
          </h2>
        </div>

        {/* Metrics */}
        <div className="mb-5 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-2xl border border-gray-100 bg-white px-6 py-4 shadow-sm">
          <div className="flex items-center gap-2.5">
            <Clock3 size={18} className={pending.length > 0 ? 'text-amber-600' : 'text-gray-400'} />
            <span className="text-lg font-bold text-gray-900">{pending.length}</span>
            <span className="text-xs text-gray-500">Menunggu review</span>
          </div>
          <div className="h-8 w-px bg-gray-100" />
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={18} className="text-green-600" />
            <span className="text-lg font-bold text-gray-900">{disetujuiBulanIni}</span>
            <span className="text-xs text-gray-500">Disetujui bulan ini</span>
          </div>
          <div className="h-8 w-px bg-gray-100" />
          <div className="flex items-center gap-2.5">
            <XCircle size={18} className="text-red-500" />
            <span className="text-lg font-bold text-gray-900">{ditolakBulanIni}</span>
            <span className="text-xs text-gray-500">Ditolak bulan ini</span>
          </div>
          <div className="h-8 w-px bg-gray-100" />
          <div className="flex items-center gap-2.5">
            <ListChecks size={18} className="text-gray-400" />
            <span className="text-lg font-bold text-gray-900">{pengajuan.length}</span>
            <span className="text-xs text-gray-500">Total pengajuan</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">

          <div>
            {/* Menunggu persetujuan */}
            <div className="mb-4 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <span className="text-[13px] font-semibold text-gray-900">Menunggu persetujuan</span>
                {pending.length > 0 && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                    {pending.length} pending
                  </span>
                )}
              </div>

              {pending.length === 0 ? (
                <div className="px-8 py-10 text-center text-[13px] text-gray-400">
                  Tidak ada pengajuan yang menunggu
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-gray-50 text-xs font-medium text-gray-500">
                        <th className="px-5 py-2.5 font-medium">Nama guru</th>
                        <th className="px-2 py-2.5 font-medium">Jenis</th>
                        <th className="px-2 py-2.5 font-medium">Tanggal</th>
                        <th className="px-2 py-2.5 font-medium">Hari</th>
                        <th className="px-5 py-2.5 font-medium">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((p, i) => (
                        <tr key={p.id} className={i < pending.length - 1 ? 'border-b border-gray-50' : ''}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <AvatarChip nama={p.guru?.nama} index={i} />
                              <div>
                                <div className="text-[13px] font-medium text-gray-900">{p.guru?.nama}</div>
                                <div className="text-[11px] text-gray-400">{p.guru?.mapel}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-3 text-[12px] text-gray-600">
                            {p.jenisCuti.charAt(0) + p.jenisCuti.slice(1).toLowerCase()}
                          </td>
                          <td className="px-2 py-3 text-[12px] text-gray-600">
                            {formatTgl(p.tanggalMulai)} – {formatTgl(p.tanggalSelesai)}
                          </td>
                          <td className="px-2 py-3 text-[12px] font-medium text-gray-700">{p.jumlahHari}</td>
                          <td className="px-5 py-3">
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => { setModal({ id: p.id, action: 'approve' }); setCatatan('') }}
                                className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-[11px] font-medium text-green-600"
                              >
                                Setuju
                              </button>
                              <button
                                onClick={() => { setModal({ id: p.id, action: 'reject' }); setCatatan('') }}
                                className="rounded-lg border border-red-200 bg-transparent px-2.5 py-1.5 text-[11px] text-red-600"
                              >
                                Tolak
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Riwayat keputusan */}
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-3.5">
                <span className="text-[13px] font-semibold text-gray-900">Riwayat keputusan</span>
              </div>
              {riwayat.length === 0 ? (
                <div className="px-5 py-6 text-center text-[13px] text-gray-400">Belum ada riwayat</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-gray-50 text-xs font-medium text-gray-500">
                        <th className="px-5 py-2.5 font-medium">Nama guru</th>
                        <th className="px-2 py-2.5 font-medium">Jenis</th>
                        <th className="px-2 py-2.5 font-medium">Tanggal</th>
                        <th className="px-2 py-2.5 font-medium">Hari</th>
                        <th className="px-5 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {riwayat.slice(0, 5).map((p, i) => (
                        <tr key={p.id} className={i < Math.min(riwayat.length, 5) - 1 ? 'border-b border-gray-50' : ''}>
                          <td className="px-5 py-3 text-[13px] font-medium text-gray-900">{p.guru?.nama}</td>
                          <td className="px-2 py-3 text-[12px] text-gray-600">{p.jenisCuti.charAt(0) + p.jenisCuti.slice(1).toLowerCase()}</td>
                          <td className="px-2 py-3 text-[12px] text-gray-600">{formatTgl(p.tanggalMulai)}</td>
                          <td className="px-2 py-3 text-[12px] text-gray-700">{p.jumlahHari}</td>
                          <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Notifikasi */}
          <div>
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-3.5">
                <span className="text-[13px] font-semibold text-gray-900">Notifikasi masuk</span>
              </div>
              {notifikasi.length === 0 ? (
                <div className="px-5 py-6 text-center text-[13px] text-gray-400">Belum ada notifikasi</div>
              ) : (
                notifikasi.slice(0, 5).map((n, i) => (
                  <div key={n.id} className={`px-5 py-3.5 ${i < Math.min(notifikasi.length, 5) - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="flex items-start gap-2.5">
                      <div className="mt-1 size-2 shrink-0 rounded-full bg-amber-400" />
                      <div>
                        <div className="text-[13px] font-medium text-gray-900">{n.judul}</div>
                        <div className="mt-0.5 text-xs leading-relaxed text-gray-500">{n.pesan}</div>
                        <div className="mt-1.5 text-[11px] text-gray-400">
                          {new Date(n.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}