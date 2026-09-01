export function BlackHoleModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center animate-fade-in p-4">
      <div className="glass-modal shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
        <div className="p-6">
          <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">macOS Audio Setup Required</h2>
          <p className="text-sm text-gray-600 mb-4 leading-relaxed">
            To capture other participants' voices while wearing headphones on your Mac, you need a virtual audio driver like <strong>BlackHole (2ch)</strong>. Without it, macOS blocks the app from recording the meeting audio.
          </p>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">How to install via Homebrew:</p>
            <code className="block bg-gray-900 text-gray-100 text-sm p-3 rounded-md font-mono mb-2">
              brew install blackhole-2ch
            </code>
            <p className="text-xs text-gray-500 mt-3">
              After installing, open <strong>Audio MIDI Setup</strong> on your Mac and create a "Multi-Output Device" (Headphones + BlackHole), then select it as your output device.
            </p>
          </div>
        </div>
        <div className="bg-gray-50 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-[#1B4FCC] hover:bg-[#1644B8] text-white text-sm font-medium rounded-lg transition-colors"
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  )
}
