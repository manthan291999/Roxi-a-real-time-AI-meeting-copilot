function jaccardSimilarity(s1, s2) {
  const set1 = new Set(s1.toLowerCase().split(/\W+/));
  const set2 = new Set(s2.toLowerCase().split(/\W+/));
  if (set1.size === 0 || set2.size === 0) return 0;

  let intersection = 0;
  for (const w of set1) {
    if (set2.has(w)) intersection++;
  }
  const union = set1.size + set2.size - intersection;
  return intersection / union;
}

function exceedsSimilarityThreshold(candidates, text, threshold = 0.6) {
  return candidates.some(
    (candidate) => jaccardSimilarity(text, candidate) > threshold
  );
}

module.exports = {
  jaccardSimilarity,
  exceedsSimilarityThreshold,
};
