export function ConfirmModal({ modal, catatan, setCatatan, processing, onClose, onConfirm }) {
  if (!modal) return null

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-5">
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="mb-2 text-[15px] font-semibold text-gray-900">
          {modal.action === 'approve' ? 'Setujui pengajuan cuti?' : 'Tolak pengajuan cuti?'}
        </h3>
        <p className="mb-4 text-xs leading-relaxed text-gray-500">
          {modal.action === 'approve'
            ? 'Setelah disetujui, sistem akan otomatis mengurangi kuota, generate surat PDF, dan mengirim email ke guru.'
            : 'Guru akan mendapat notifikasi penolakan beserta alasan yang kamu tulis.'}
        </p>
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-gray-700">
            {modal.action === 'approve' ? 'Catatan (opsional)' : 'Alasan penolakan *'}
          </label>
          <textarea
            value={catatan}
            onChange={e => setCatatan(e.target.value)}
            placeholder={modal.action === 'approve' ? 'Tambahkan catatan...' : 'Tulis alasan penolakan...'}
            rows={3}
            className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2.5 text-[13px] text-gray-900 outline-none focus:border-gray-400"
          />
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            disabled={processing}
            className="flex-1 rounded-lg border border-gray-300 bg-transparent py-2.5 text-[13px] text-gray-700"
          >
            Batal
          </button>
          <button
            onClick={onConfirm}
            disabled={processing}
            className={`flex-[2] rounded-lg py-2.5 text-[13px] font-medium text-white ${
              processing ? 'bg-gray-400 cursor-not-allowed' : modal.action === 'approve' ? 'bg-green-600' : 'bg-red-600'
            }`}
          >
            {processing ? 'Memproses...' : modal.action === 'approve' ? 'Ya, Setujui' : 'Ya, Tolak'}
          </button>
        </div>
      </div>
    </div>
  )
}