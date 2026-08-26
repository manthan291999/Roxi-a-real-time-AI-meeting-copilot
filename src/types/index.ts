export type Status = 'idle' | 'connecting' | 'live' | 'live-backup' | 'unavailable' | 'cost-limit'
export type Significance = 'none' | 'low' | 'medium' | 'high'

export interface TxLine {
  id: string
  speaker: string
  speakerIdx: number
  text: string
  partial: boolean
  time: string
}

export interface SCard { id: string; text: string; sig: Significance; time: string; speaker: string; speakerIdx: number }
export interface TCard { id: string; text: string; sig: Significance; time: string; speaker: string; speakerIdx: number }
export interface RCard { id: string; text: string; type?: 'reply' | 'decision' | 'action'; assignee?: string; speaker?: string; speakerIdx?: number }

export interface DbMeeting {
  id: number
  start_time: string
  summary: string | null
}

export interface DbMeetingDetails {
  meeting: DbMeeting
  transcripts: { id: number; speaker: string; text: string; timestamp: string }[]
  decisions: { id: number; description: string; timestamp: string }[]
  action_items: { id: number; assignee: string; description: string; timestamp: string }[]
  technical_analyses: { id: number; description: string; timestamp: string }[]
  suggested_replies: { id: number; text: string; timestamp: string }[]
}

export interface SpeakerEntry {
  sttLabel: string
  displayName: string
}

export interface ApiKey {
  index: number
  state: string
  cooldownRemainingMs: number
}
