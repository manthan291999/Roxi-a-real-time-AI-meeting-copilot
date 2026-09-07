const colors = [
  '#60a5fa', // blue-400
  '#a78bfa', // purple-400
  '#22d3ee', // cyan-400
  '#34d399', // emerald-400
  '#fb923c', // orange-400
];

export function getSpeakerColor(idx?: number): string {
  if (idx === undefined || idx < 0) return colors[0];
  return colors[idx % colors.length];
}
