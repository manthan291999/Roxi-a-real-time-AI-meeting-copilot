import { useContext } from 'react'
import { useHistory } from './useHistory'
import { DbMeeting, DbMeetingDetails } from '../../types'
import { EmptySlate, SpeakerChip } from '../../components/Shared'
import { SPEAKER_COLORS } from '../../constants'
import { ServicesContext } from '../../context/ServicesContext'

export function HistoryView({ onClose }: { onClose: () => void }) {
  const { meetings, selected, details, loading, loadingDetails, selectMeeting } = useHistory()
  const services = useContext(ServicesContext)

  const resolveSpeakerIdx = (speakerName: string) => {
    return services?.speakerRepo.resolveIndex(speakerName) ?? 0
  }

  function formatDate(ts: string) {
    return new Date(ts + 'Z').toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/20 backdrop-blur-sm animate-fade-in cursor-pointer"
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div className="w-[820px] max-w-[90vw] h-full bg-white shadow-2xl flex flex-col animate-history-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5" strokeLinecap="round" />
              <path d="M13.5 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 5.5V8l2 1.5" strokeLinecap="round" />
            </svg>
            <span className="font-semibold text-sm text-gray-900">Meeting History</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 min-h-0 bg-white">
          {!selected ? (
            /* Meeting list (Full Width) */
            <div className="w-full flex-shrink-0 overflow-y-auto hide-scroll">
              <div className="p-6 max-w-4xl mx-auto">
                <h2 className="text-2xl font-semibold text-gray-900 mb-6">Past Meetings</h2>
                {loading && (
                  <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
                )}
                {!loading && meetings.length === 0 && (
                  <div className="flex items-center justify-center mt-10">
                    <EmptySlate>No past meetings found.</EmptySlate>
                  </div>
                )}
                <div className="space-y-3">
                  {meetings.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => selectMeeting(m)}
                      className="w-full text-left px-5 py-4 rounded-xl transition-all hover:bg-gray-50 border border-gray-100 shadow-sm hover:shadow flex items-center justify-between group"
                    >
                      <div>
                        <p className="text-[15px] font-medium leading-snug mb-1.5 text-gray-900">
                          {m.summary ? m.summary.substring(0, 80) + '…' : 'Meeting #' + m.id}
                        </p>
                        <div className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="font-mono text-[11px] text-gray-500">{formatDate(m.start_time)}</span>
                        </div>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center group-hover:bg-blue-50 group-hover:text-blue-600 text-gray-300 transition-colors">
                        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Meeting detail (Full Width) */
            <div className="flex-1 min-w-0 overflow-y-auto hide-scroll bg-white">
              <div className="max-w-4xl mx-auto px-6 py-6">
                <button
                  onClick={() => selectMeeting(null as unknown as DbMeeting)}
                  className="mb-6 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back to Meetings
                </button>

                {loadingDetails ? (
                  <div className="flex items-center justify-center py-10">
                    <p className="text-sm text-gray-400">Loading details…</p>
                  </div>
                ) : details ? (
                  <>
                    <div className="mb-8 border-b border-gray-100 pb-6">
                      <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                        Meeting on {formatDate(details.meeting.start_time)}
                      </h2>
                      <span className="font-mono text-sm text-gray-400">ID #{details.meeting.id}</span>
                    </div>

                    {/* Executive Summary */}
                    {details.meeting.summary && (
                      <div className="mb-5 p-4 bg-gray-50 border border-gray-100 rounded-xl">
                        <h3 className="font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-gray-400 mb-3">Executive Summary</h3>
                        <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                          {details.meeting.summary}
                        </div>
                      </div>
                    )}

                    {/* Decisions */}
                    {details.decisions.length > 0 && (
                      <div className="mb-5">
                        <h3 className="font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-gray-400 mb-3">Decisions</h3>
                        <div className="space-y-2">
                          {details.decisions.map((d, i) => (
                            <div key={i} className="flex items-start gap-2.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-[#1B4FCC] mt-[5px] flex-shrink-0" />
                              <p className="text-sm text-gray-700 leading-relaxed">{d.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Items */}
                    {details.action_items.length > 0 && (
                      <div className="mb-5">
                        <h3 className="font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-gray-400 mb-3">Action Items</h3>
                        <div className="space-y-2">
                          {details.action_items.map((a, i) => (
                            <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-gray-50">
                              <svg className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="2" y="2" width="12" height="12" rx="2" />
                                <path d="M5 8l2 2 4-3" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] text-gray-700 leading-snug mb-1">{a.description}</p>
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-gray-200 rounded-full text-[10px] text-gray-500 font-medium">
                                  {a.assignee || 'Unassigned'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Technical Analysis */}
                    {details.technical_analyses && details.technical_analyses.length > 0 && (
                      <div className="mb-5">
                        <h3 className="font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-gray-400 mb-3">Technical Analysis</h3>
                        <div className="space-y-2">
                          {details.technical_analyses.map((t, i) => (
                            <div key={i} className="p-3 bg-purple-50/50 rounded-lg border border-purple-100/50">
                              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{t.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Suggested Replies */}
                    {details.suggested_replies && details.suggested_replies.length > 0 && (
                      <div className="mb-5">
                        <h3 className="font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-gray-400 mb-3">Suggested Replies</h3>
                        <div className="space-y-2">
                          {details.suggested_replies.map((r, i) => (
                            <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-green-50/50 border border-green-100/50">
                              <svg className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M4 8l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <p className="text-[13px] text-gray-700 leading-snug mb-1">{r.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Transcript */}
                    <div>
                      <h3 className="font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-gray-400 mb-3">Transcript</h3>
                      {details.transcripts.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">No transcript recorded.</p>
                      ) : (
                        <div className="space-y-3">
                          {details.transcripts.map((line, i) => {
                            const idx = resolveSpeakerIdx(line.speaker)
                            const c = SPEAKER_COLORS[idx % SPEAKER_COLORS.length]
                            return (
                              <div key={i}>
                                <div className="flex items-center gap-2 mb-1">
                                  <SpeakerChip name={line.speaker} idx={idx} />
                                </div>
                                <div className="pl-3 border-l-2 ml-0.5" style={{ borderLeftColor: c.stripeColor }}>
                                  <p className="text-[13px] text-gray-700 leading-relaxed">{line.text}</p>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center py-10">
                    <EmptySlate>Failed to load meeting details.</EmptySlate>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
