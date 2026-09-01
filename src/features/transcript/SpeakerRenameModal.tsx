import { useState, useContext } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { SPEAKER_COLORS } from '../../constants'
import { ServicesContext } from '../../context/ServicesContext'

export interface SpeakerEntry { sttLabel: string; displayName: string }

export function SpeakerRenameModal({ speakers, onClose }: { speakers: SpeakerEntry[]; onClose: () => void }) {
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(speakers.map(s => [s.sttLabel, s.displayName]))
  )
  const services = useContext(ServicesContext)
  const [saving, setSaving] = useState(false)

  const resolveSpeakerIdx = (sttLabel: string) => {
    return services?.speakerRepo.resolveIndex(sttLabel) ?? 0
  }

  const handleSave = async () => {
    setSaving(true)
    for (const s of speakers) {
      const newName = (names[s.sttLabel] || '').trim()
      if (newName && newName !== s.displayName) {
        try {
          await invoke('rename_speaker', { sttLabel: s.sttLabel, displayName: newName })
        } catch (_) { /* sidecar rename command — best effort */ }
      }
    }
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="glass-modal shadow-2xl w-[380px] overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Rename Speakers</h2>
            <p className="text-xs text-gray-400 mt-0.5">Names persist across sessions</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-4 h-4 text-gray-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {speakers.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No speakers detected yet. Start a capture first.</p>
          ) : speakers.map(s => {
            const idx = resolveSpeakerIdx(s.sttLabel)
            const c = SPEAKER_COLORS[idx % SPEAKER_COLORS.length]
            return (
              <div key={s.sttLabel} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
                <span className="text-xs text-gray-400 w-20 truncate flex-shrink-0 font-mono">{s.sttLabel}</span>
                <input
                  type="text"
                  value={names[s.sttLabel] ?? s.displayName}
                  onChange={e => setNames(prev => ({ ...prev, [s.sttLabel]: e.target.value }))}
                  placeholder={s.displayName}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                />
              </div>
            )
          })}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#1B4FCC] hover:bg-[#1644B8] rounded-lg transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save Names'}
          </button>
        </div>
      </div>
    </div>
  )
}
