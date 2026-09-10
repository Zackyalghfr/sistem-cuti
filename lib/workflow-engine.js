import { prisma } from './prisma'
import nodemailer from 'nodemailer'
import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'

// ─────────────────────────────────────
// ENTRY POINT — panggil flow berdasarkan nama
// ─────────────────────────────────────
export async function runFlow(flowName, payload = {}) {
  console.log(`[ENGINE] Mulai flow: ${flowName}`)
  const startTime = Date.now()

  try {
    switch (flowName) {
      case 'flow-pengajuan':
        return await flowPengajuan(payload)
      case 'flow-approval':
        return await flowApproval(payload)
      case 'flow-penolakan':
        return await flowPenolakan(payload)
      case 'flow-eksekusi':
        return await flowEksekusi(payload)
      case 'flow-reminder':
        return await flowReminder(payload)
      default:
        throw new Error(`Flow tidak dikenal: ${flowName}`)
    }
  } catch (error) {
    console.error(`[ENGINE] Flow ${flowName} gagal:`, error.message)
    await saveLog(payload?.pengajuanId || null, flowName, 'error', 'FAILED', error.message, Date.now() - startTime)
    throw error
  }
}

// ─────────────────────────────────────
// FLOW 1 — Pengajuan cuti oleh guru
// Dipanggil dari: POST /api/cuti
// ─────────────────────────────────────
async function flowPengajuan(payload) {
  const { guruId, jenisCuti, tanggalMulai, tanggalSelesai, jumlahHari, alasan, penggantiNama } = payload

  // Step 1: Validasi kuota
  await logStep(null, 'flow-pengajuan', 'validasi-kuota', async () => {
    const kuota = await prisma.kuotaCuti.findUnique({ where: { userId: guruId } })
    if (!kuota) throw new Error('Data kuota guru tidak ditemukan')
    if (kuota.terpakai + kuota.pending + jumlahHari > kuota.totalKuota) {
      throw new Error(`Kuota tidak cukup. Sisa: ${kuota.totalKuota - kuota.terpakai - kuota.pending} hari`)
    }
  })

  // Step 2 & 3: Simpan pengajuan dan update kuota pending secara atomik
  let pengajuan
  await logStep(null, 'flow-pengajuan', 'simpan-pengajuan-dan-kuota', async () => {
    const result = await prisma.$transaction(async (tx) => {
      const createdPengajuan = await tx.pengajuanCuti.create({
        data: {
          guruId,
          jenisCuti,
          tanggalMulai: new Date(tanggalMulai),
          tanggalSelesai: new Date(tanggalSelesai),
          jumlahHari,
          alasan,
          penggantiNama,
          status: 'PENDING'
        }
      })

      await tx.kuotaCuti.update({
        where: { userId: guruId },
        data: { pending: { increment: jumlahHari } }
      })

      return createdPengajuan
    })

    pengajuan = result
  })

  // Step 4: Simpan notifikasi in-app untuk KS
  let ksUser = null
  let guruUser = null
  await logStep(pengajuan.id, 'flow-pengajuan', 'notifikasi-ks', async () => {
    ksUser = await prisma.user.findFirst({ where: { role: 'KEPALA_SEKOLAH' } })
    guruUser = await prisma.user.findUnique({ where: { id: guruId } })
    if (ksUser && guruUser) {
      await prisma.notifikasi.create({
        data: {
          userId: ksUser.id,
          pengajuanId: pengajuan.id,
          judul: 'Pengajuan cuti baru',
          pesan: `${guruUser.nama} mengajukan cuti ${jenisCuti.toLowerCase()} selama ${jumlahHari} hari`
        }
      })
    }
  })

  // Step 5: Kirim email ke KS (Non-blocking: kegagalan email tidak membatalkan pengajuan)
  if (ksUser && guruUser && ksUser.email) {
    await logStep(pengajuan.id, 'flow-pengajuan', 'kirim-email-ks', async () => {
      await kirimEmail({
        to: ksUser.email,
        subject: `[SiCuti] Pengajuan cuti baru — ${guruUser.nama}`,
        html: templateEmailKs(guruUser, pengajuan)
      })
    }, { nonBlocking: true })
  }

  return { success: true, pengajuanId: pengajuan.id }
}

// ─────────────────────────────────────
// FLOW 2 — Persetujuan oleh KS
// Dipanggil dari: POST /api/cuti/[id]/approve
// ─────────────────────────────────────
async function flowApproval(payload) {
  const { pengajuanId, ksId, catatan } = payload

  // Step 1: Ambil data pengajuan & validasi status
  let pengajuan
  await logStep(pengajuanId, 'flow-approval', 'ambil-pengajuan', async () => {
    pengajuan = await prisma.pengajuanCuti.findUnique({
      where: { id: pengajuanId },
      include: { guru: true }
    })
    if (!pengajuan) throw new Error('Pengajuan tidak ditemukan')
    if (pengajuan.status !== 'PENDING') throw new Error('Pengajuan sudah diproses sebelumnya')
  })

  // Step 2: Update status APPROVED, potong kuota terpakai, kurangi pending, dan update jadwal (Atomik)
  await logStep(pengajuanId, 'flow-approval', 'update-status-dan-kuota', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.pengajuanCuti.update({
        where: { id: pengajuanId },
        data: {
          status: 'APPROVED',
          approvedById: ksId,
          approvedAt: new Date(),
          catatanKs: catatan || null
        }
      })

      await tx.kuotaCuti.update({
        where: { userId: pengajuan.guruId },
        data: {
          terpakai: { increment: pengajuan.jumlahHari },
          pending: { decrement: pengajuan.jumlahHari }
        }
      })

      await tx.jadwalMengajar.updateMany({
        where: {
          guruId: pengajuan.guruId,
          tanggal: {
            gte: pengajuan.tanggalMulai,
            lte: pengajuan.tanggalSelesai
          }
        },
        data: { status: 'CUTI' }
      })
    })
  })

  // Step 3: Jalankan flow eksekusi otomatis (PDF, notifikasi, email guru)
  await flowEksekusi({ pengajuanId, pengajuan: { ...pengajuan, catatanKs: catatan } })

  return { success: true }
}

// ─────────────────────────────────────
// FLOW 3 — Eksekusi otomatis pasca approval
// Dipanggil otomatis oleh flow-approval
// ─────────────────────────────────────
async function flowEksekusi(payload) {
  const { pengajuanId } = payload

  let pengajuan = payload.pengajuan
  if (!pengajuan || !pengajuan.guru) {
    pengajuan = await prisma.pengajuanCuti.findUnique({
      where: { id: pengajuanId },
      include: { guru: true, approvedBy: true }
    })
  }

  // Step 1: Generate surat keterangan PDF (Non-blocking jika browser/puppeteer terkendala)
  let suratUrl = null
  await logStep(pengajuanId, 'flow-eksekusi', 'generate-surat', async () => {
    suratUrl = await generateSuratPDF(pengajuan)
    if (suratUrl) {
      await prisma.pengajuanCuti.update({
        where: { id: pengajuanId },
        data: { suratUrl }
      })
    }
  }, { nonBlocking: true })

  // Step 2: Simpan notifikasi in-app untuk guru
  await logStep(pengajuanId, 'flow-eksekusi', 'notifikasi-guru', async () => {
    await prisma.notifikasi.create({
      data: {
        userId: pengajuan.guruId,
        pengajuanId,
        judul: 'Cuti disetujui',
        pesan: `Cuti ${pengajuan.jenisCuti.toLowerCase()} Anda ${formatTanggal(pengajuan.tanggalMulai)}–${formatTanggal(pengajuan.tanggalSelesai)} telah disetujui. Surat keterangan sudah dapat diakses di sistem.`
      }
    })
  })

  // Step 3: Kirim email + lampiran surat ke guru (Non-blocking)
  if (pengajuan.guru?.email) {
    await logStep(pengajuanId, 'flow-eksekusi', 'kirim-email-guru', async () => {
      const attachments = []
      if (suratUrl) {
        const fullPdfPath = path.join(process.cwd(), 'public', suratUrl)
        if (fs.existsSync(fullPdfPath)) {
          attachments.push({ filename: `surat_cuti_${pengajuanId}.pdf`, path: fullPdfPath })
        }
      }

      await kirimEmail({
        to: pengajuan.guru.email,
        subject: '[SiCuti] Cuti Anda telah disetujui',
        html: templateEmailGuru(pengajuan),
        attachments
      })
    }, { nonBlocking: true })
  }

  return { success: true, suratUrl }
}

// ─────────────────────────────────────
// FLOW 4 — Penolakan oleh KS
// Dipanggil dari: POST /api/cuti/[id]/reject
// ─────────────────────────────────────
async function flowPenolakan(payload) {
  const { pengajuanId, ksId, catatan } = payload

  let pengajuan
  // Step 1 & 2: Update status REJECTED dan kembalikan kuota pending secara atomik
  await logStep(pengajuanId, 'flow-penolakan', 'update-status-dan-kembalikan-kuota', async () => {
    const result = await prisma.$transaction(async (tx) => {
      const updatedPengajuan = await tx.pengajuanCuti.update({
        where: { id: pengajuanId },
        data: {
          status: 'REJECTED',
          approvedById: ksId,
          approvedAt: new Date(),
          catatanKs: catatan
        },
        include: { guru: true }
      })

      await tx.kuotaCuti.update({
        where: { userId: updatedPengajuan.guruId },
        data: { pending: { decrement: updatedPengajuan.jumlahHari } }
      })

      return updatedPengajuan
    })

    pengajuan = result
  })

  // Step 3: Simpan notifikasi in-app ke guru
  await logStep(pengajuanId, 'flow-penolakan', 'notifikasi-guru', async () => {
    await prisma.notifikasi.create({
      data: {
        userId: pengajuan.guruId,
        pengajuanId,
        judul: 'Pengajuan cuti ditolak',
        pesan: `Pengajuan cuti Anda ditolak. Alasan: ${catatan || 'Tidak ada catatan'}`
      }
    })
  })

  // Step 4: Kirim email penolakan ke guru (Non-blocking)
  if (pengajuan.guru?.email) {
    await logStep(pengajuanId, 'flow-penolakan', 'kirim-email-guru', async () => {
      await kirimEmail({
        to: pengajuan.guru.email,
        subject: '[SiCuti] Pengajuan cuti Anda ditolak',
        html: templateEmailTolak(pengajuan, catatan)
      })
    }, { nonBlocking: true })
  }

  return { success: true }
}

// ─────────────────────────────────────
// FLOW 5 — Reminder kuota hampir habis
// Dipanggil oleh Scheduler (cron) tiap tgl 1
// ─────────────────────────────────────
export async function flowReminder() {
  const semuaKuota = await prisma.kuotaCuti.findMany({
    include: { user: true }
  })

  for (const kuota of semuaKuota) {
    const sisaKuota = kuota.totalKuota - kuota.terpakai - kuota.pending
    if (sisaKuota <= 3 && kuota.user?.email) {
      try {
        await kirimEmail({
          to: kuota.user.email,
          subject: '[SiCuti] Reminder: Kuota Cuti Menipis',
          html: templateEmailReminder(kuota.user, sisaKuota)
        })
      } catch (e) {
        console.error(`[REMINDER] Gagal kirim email ke ${kuota.user.email}:`, e.message)
      }
    }
  }
}

// ─────────────────────────────────────
// HELPER: Generate PDF dengan Puppeteer
// ─────────────────────────────────────
async function generateSuratPDF(pengajuan) {
  // Ambil data Kepala Sekolah untuk tanda tangan dinamis
  let ksUser = pengajuan.approvedBy
  if (!ksUser && pengajuan.approvedById) {
    ksUser = await prisma.user.findUnique({ where: { id: pengajuan.approvedById } })
  }
  if (!ksUser) {
    ksUser = await prisma.user.findFirst({ where: { role: 'KEPALA_SEKOLAH' } })
  }

  const ksNama = ksUser?.nama || 'Kepala Sekolah'
  const ksNip = ksUser?.nip ? `NIP. ${ksUser.nip}` : 'NIP. -'

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8"/>
      <style>
        body { font-family: 'Times New Roman', serif; margin: 40px; color: #000; }
        .header { text-align: center; border-bottom: 3px double #000; padding-bottom: 12px; margin-bottom: 24px; }
        .header h2 { font-size: 16px; margin: 4px 0; }
        .header h3 { font-size: 14px; margin: 2px 0; font-weight: normal; }
        .title { text-align: center; font-size: 15px; font-weight: bold; margin: 20px 0; text-decoration: underline; }
        .nomor { text-align: center; font-size: 13px; margin-bottom: 20px; }
        .isi { font-size: 13px; line-height: 1.8; }
        table.data { margin: 12px 0 12px 20px; font-size: 13px; }
        table.data td { padding: 2px 8px 2px 0; }
        .ttd { margin-top: 40px; float: right; text-align: center; }
        .ttd .garis { margin-top: 60px; border-top: 1px solid #000; padding-top: 4px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>PEMERINTAH KOTA ...</h2>
        <h2>DINAS PENDIDIKAN</h2>
        <h3>SMA NEGERI 1 ...</h3>
        <h3>Alamat: Jl. ... | Telp: ...</h3>
      </div>
      <div class="title">SURAT KETERANGAN CUTI</div>
      <div class="nomor">Nomor: ${pengajuan.id.slice(0, 8).toUpperCase()}/CUTI/${new Date().getFullYear()}</div>
      <div class="isi">
        <p>Yang bertanda tangan di bawah ini, Kepala SMA Negeri 1 ..., dengan ini menerangkan bahwa:</p>
        <table class="data">
          <tr><td>Nama</td><td>:</td><td><strong>${pengajuan.guru.nama}</strong></td></tr>
          <tr><td>NIP</td><td>:</td><td>${pengajuan.guru.nip || '-'}</td></tr>
          <tr><td>Jabatan</td><td>:</td><td>Guru ${pengajuan.guru.mapel || ''}</td></tr>
          <tr><td>Jenis Cuti</td><td>:</td><td>${pengajuan.jenisCuti}</td></tr>
          <tr><td>Lama Cuti</td><td>:</td><td>${pengajuan.jumlahHari} hari kerja</td></tr>
          <tr><td>Tanggal</td><td>:</td><td>${formatTanggal(pengajuan.tanggalMulai)} s/d ${formatTanggal(pengajuan.tanggalSelesai)}</td></tr>
          <tr><td>Alasan</td><td>:</td><td>${pengajuan.alasan}</td></tr>
        </table>
        <p>Demikian surat keterangan ini dibuat untuk dapat digunakan sebagaimana mestinya.</p>
      </div>
      <div class="ttd">
        <p>${formatTanggalPanjang(pengajuan.approvedAt || new Date())}</p>
        <p>Kepala Sekolah,</p>
        <div class="garis">
          <p><strong>${ksNama}</strong></p>
          <p>${ksNip}</p>
        </div>
      </div>
    </body>
    </html>
  `

  const outputDir = path.join(process.cwd(), 'public', 'surat')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  const filename = `surat_cuti_${pengajuan.id}.pdf`
  const outputPath = path.join(outputDir, filename)

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    await page.pdf({
      path: outputPath,
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '25mm', right: '20mm' }
    })
  } finally {
    await browser.close()
  }

  return `/surat/${filename}`
}

// ─────────────────────────────────────
// HELPER: Kirim email via Nodemailer
// ─────────────────────────────────────
async function kirimEmail({ to, subject, html, attachments = [] }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[EMAIL] SMTP_USER atau SMTP_PASS belum dikonfigurasi, pengiriman email dilewati.')
    return
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'SiCuti <noreply@sekolah.sch.id>',
    to,
    subject,
    html,
    attachments
  })
}

// ─────────────────────────────────────
// HELPER: Simpan log eksekusi ke DB
// ─────────────────────────────────────
async function logStep(pengajuanId, namaFlow, namaStep, fn, options = {}) {
  const start = Date.now()
  try {
    const result = await fn()
    const durasi = Date.now() - start
    await saveLog(pengajuanId, namaFlow, namaStep, 'SUCCESS', null, durasi)
    console.log(`[${namaFlow}] ✓ ${namaStep} (${durasi}ms)`)
    return result
  } catch (error) {
    const durasi = Date.now() - start
    await saveLog(pengajuanId, namaFlow, namaStep, 'FAILED', error.message, durasi)
    console.error(`[${namaFlow}] ✗ ${namaStep}: ${error.message}`)
    if (!options.nonBlocking) {
      throw error
    }
  }
}

async function saveLog(pengajuanId, namaFlow, namaStep, status, pesan, durasi) {
  try {
    await prisma.logEksekusi.create({
      data: { pengajuanId, namaFlow, namaStep, status, pesan, durasi }
    })
  } catch (e) {
    console.error('[LOG] Gagal simpan log:', e.message)
  }
}

// ─────────────────────────────────────
// HELPER: Format tanggal
// ─────────────────────────────────────
function formatTanggal(date) {
  return new Date(date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTanggalPanjang(date) {
  return new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ─────────────────────────────────────
// TEMPLATE EMAIL
// ─────────────────────────────────────
function templateEmailKs(guru, pengajuan) {
  return `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
      <h3>Pengajuan Cuti Baru</h3>
      <p><strong>${guru.nama}</strong> mengajukan cuti:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#666">Jenis</td><td>${pengajuan.jenisCuti}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Tanggal</td><td>${formatTanggal(pengajuan.tanggalMulai)} – ${formatTanggal(pengajuan.tanggalSelesai)}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Durasi</td><td>${pengajuan.jumlahHari} hari</td></tr>
        <tr><td style="padding:6px 0;color:#666">Alasan</td><td>${pengajuan.alasan}</td></tr>
      </table>
      <p>Silakan login ke SiCuti untuk menyetujui atau menolak pengajuan ini.</p>
    </div>
  `
}

function templateEmailGuru(pengajuan) {
  return `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
      <h3 style="color:#16a34a">Cuti Anda Disetujui</h3>
      <p>Pengajuan cuti <strong>${pengajuan.jenisCuti.toLowerCase()}</strong> Anda telah disetujui.</p>
      <p>Periode: <strong>${formatTanggal(pengajuan.tanggalMulai)} – ${formatTanggal(pengajuan.tanggalSelesai)}</strong></p>
      <p>Surat keterangan cuti terlampir pada email ini.</p>
      ${pengajuan.catatanKs ? `<p>Catatan KS: ${pengajuan.catatanKs}</p>` : ''}
    </div>
  `
}

function templateEmailTolak(pengajuan, catatan) {
  return `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
      <h3 style="color:#dc2626">Pengajuan Cuti Ditolak</h3>
      <p>Pengajuan cuti <strong>${pengajuan.jenisCuti.toLowerCase()}</strong> Anda tidak dapat disetujui.</p>
      <p>Alasan: <strong>${catatan || 'Tidak ada catatan'}</strong></p>
      <p>Silakan hubungi Kepala Sekolah untuk informasi lebih lanjut.</p>
    </div>
  `
}

function templateEmailReminder(user, sisaKuota) {
  return `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
      <h3 style="color:#d97706">Reminder: Sisa Kuota Cuti</h3>
      <p>Yth. <strong>${user.nama}</strong>,</p>
      <p>Sisa kuota cuti Anda tinggal <strong>${sisaKuota} hari</strong> untuk tahun ini.</p>
      <p>Gunakan dengan bijak sebelum akhir tahun.</p>
    </div>
  `
}
