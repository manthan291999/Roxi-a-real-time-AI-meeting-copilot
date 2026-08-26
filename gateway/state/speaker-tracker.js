const { getMeetingState } = require('./meeting-state');

const MAX_SPEAKER_TOPICS = 10;

function trackSpeaker(speaker, text, significance) {
  const state = getMeetingState();
  if (!state.speaker_map[speaker]) {
    state.speaker_map[speaker] = {
      talk_time_chunks: 0,
      key_topics: [],
    };
  }

  state.speaker_map[speaker].talk_time_chunks++;

  if (significance === 3 || significance === 4) {
    state.speaker_map[speaker].key_topics.push(text);
    if (state.speaker_map[speaker].key_topics.length > MAX_SPEAKER_TOPICS) {
      state.speaker_map[speaker].key_topics.shift();
    }
  }
}

function getSpeakerStats() {
  const state = getMeetingState();
  return Object.entries(state.speaker_map).map(([name, data]) => ({
    name,
    chunkCount: data.talk_time_chunks,
    topics: data.key_topics,
  }));
}

function getTopSpeakers(speakerStats, limit = 5) {
  return Object.values(speakerStats)
    .sort((a, b) => b.chunkCount - a.chunkCount)
    .slice(0, limit);
}

module.exports = {
  trackSpeaker,
  getSpeakerStats,
  getTopSpeakers,
};
