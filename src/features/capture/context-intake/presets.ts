import { MeetingPreset, MeetingRole } from '../../../shared/types';

/**
 * Quick-select presets. Each one pre-fills the description box, so `description`
 * is written as the sentence the backend will actually receive.
 *
 * Adding a preset is a one-line change here — QuickSelectChips renders whatever
 * this array holds.
 */
export const MEETING_PRESETS: MeetingPreset[] = [
  { id: 'sprint-planning', label: 'Sprint Planning', description: 'Sprint planning session — scoping and estimating upcoming work.' },
  { id: 'arch-review', label: 'Arch Review', description: 'Architecture review — evaluating technical design and trade-offs.' },
  { id: 'client-demo', label: 'Client Demo', description: 'Client demo — walking a customer through the current build.' },
  { id: 'one-on-one', label: '1:1', description: 'One-on-one — progress, blockers and feedback.' },
  { id: 'all-hands', label: 'All Hands', description: 'All hands — company-wide updates and announcements.' },
  { id: 'interview', label: 'Interview', description: 'Candidate interview — assessing skills and fit.' },
];

/**
 * Roles the user can claim. The label is what reaches the backend prompt, so it
 * reads as a job title rather than a slug.
 */
export const MEETING_ROLES: MeetingRole[] = [
  { id: 'project-manager', label: 'Project Manager', emoji: '🧑‍💼' },
  { id: 'technical-lead', label: 'Technical Lead', emoji: '🧑‍💻' },
  { id: 'client-stakeholder', label: 'Client / Stakeholder', emoji: '🤝' },
  { id: 'designer', label: 'Designer', emoji: '🎨' },
  { id: 'executive', label: 'Executive', emoji: '👔' },
];
