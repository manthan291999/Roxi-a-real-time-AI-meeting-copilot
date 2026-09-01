import { useState, useEffect } from 'react'
import { RoxiLogo } from '../../components/Shared'

export function ContextModal({ onSubmit, onCancel }: { onSubmit: (ctx: string, role: string) => void, onCancel: () => void }) {
  const [ctx, setCtx] = useState('')
  const [selectedRole, setSelectedRole] = useState('tech_lead')

  const roles = [
    { id: 'pm',         label: '🧑‍💼 Project Manager',     depth: 'low'    },
    { id: 'tech_lead',  label: '👨‍💻 Technical Lead',       depth: 'high'   },
    { id: 'client',     label: '🤝 Client / Stakeholder', depth: 'low'    },
    { id: 'designer',   label: '🎨 Designer',              depth: 'medium' },
    { id: 'executive',  label: '👔 Executive',             depth: 'low'    },
  ]

  const chips = [
    { label: 'Sprint Planning', text: 'Sprint planning session — focus on velocity, blockers, and story point estimates' },
    { label: 'Arch Review', text: 'Architecture review — focus on system design decisions, trade-offs, and technical risks' },
    { label: 'Client Demo', text: 'Client-facing product demo — focus on feature highlights, client questions, and follow-up items' },
    { label: '1:1', text: 'One-on-one meeting — focus on personal goals, feedback, and career development' },
    { label: 'All Hands', text: 'Company all-hands — focus on announcements, strategic direction, and Q&A' },
    { label: 'Interview', text: 'Technical interview — focus on candidate assessment, problem-solving approach, and red flags' },
  ]

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onSubmit(ctx, selectedRole)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [ctx, selectedRole, onCancel, onSubmit])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/10 animate-fade-in" onClick={onCancel} />
      <div className="relative glass-modal shadow-2xl w-[520px] max-w-[90vw] p-6 animate-history-in">
        <div className="mb-6">
          <RoxiLogo />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">What is this meeting about?</h2>
        <p className="text-sm text-gray-500 mb-5">
          Providing context helps Roxi AI focus its analysis on what matters most to you.
        </p>

        <textarea
          autoFocus
          value={ctx}
          onChange={(e) => setCtx(e.target.value)}
          placeholder="e.g. Sprint planning for Q3 backend migration..."
          className="w-full h-24 p-3 bg-white/25 border border-white/50 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B4FCC]/20 focus:border-[#1B4FCC] transition-all resize-none mb-4"
        />

        <div className="mb-6">
          <p className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">Quick Select</p>
          <div className="flex flex-wrap gap-2">
            {chips.map((chip, i) => (
              <button
                key={i}
                onClick={() => setCtx(chip.text)}
                className="px-2.5 py-1.5 bg-gray-100 hover:bg-blue-50 text-gray-600 hover:text-blue-700 text-xs font-medium rounded-lg transition-colors border border-transparent hover:border-blue-100"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <p className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
            Who are you in this meeting?
          </p>
          <div className="flex flex-wrap gap-2">
            {roles.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedRole(r.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors
                  ${selectedRole === r.id
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-gray-100 text-gray-600 border-transparent hover:border-blue-100 hover:bg-blue-50'
                  }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between mt-8">
          <button
            onClick={() => onSubmit('', selectedRole)}
            className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Skip (no context)
          </button>
          <button
            onClick={() => onSubmit(ctx, selectedRole)}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-[#1B4FCC] hover:bg-[#1644B8] rounded-lg transition-colors shadow-sm"
          >
            <span className="w-2 h-2 rounded-full bg-white opacity-90" />
            Start Capture
          </button>
        </div>
      </div>
    </div>
  )
}
