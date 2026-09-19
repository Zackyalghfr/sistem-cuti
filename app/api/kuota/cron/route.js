import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client'; // Mengimpor langsung dari paket utama Prisma

// Membuat instance prisma baru agar langsung membaca skema terupdate
const prisma = new PrismaClient();

export async function GET(request) {
  // Memastikan API tidak bisa ditembak sembarangan oleh publik
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    console.log('Memulai proses otomatis: Riset kuota cuti bulanan...');

    const result = await prisma.kuotaCuti.updateMany({
      data: {
        totalKuota: 5,
        terpakai: 0,
        pending: 0,
      },
    });

    console.log(`Berhasil meriset kuota cuti untuk ${result.count} data pengguna.`);
    
    return NextResponse.json({ 
      success: true, 
      message: `Kuota cuti berhasil direset untuk ${result.count} pengguna.` 
    });
  } catch (error) {
    console.error('Gagal meriset kuota cuti:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Terjadi kesalahan pada server saat meriset kuota.' 
    }, { status: 500 });
  } finally {
    await prisma.$disconnect(); // Putuskan koneksi setelah selesai
  }
}
