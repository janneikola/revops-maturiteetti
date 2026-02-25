const db = require('../db');

const DIMENSION_KEYS = ['strategy', 'process', 'data', 'tech', 'people', 'journey'];
const MIN_RESPONSES = 10;

function calculatePercentile(value, allValues) {
  if (allValues.length === 0) return 50;
  const below = allValues.filter(v => v < value).length;
  const equal = allValues.filter(v => v === value).length;
  return Math.round(((below + 0.5 * equal) / allValues.length) * 100);
}

function mean(values) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

module.exports = {
  getBenchmarks(scores) {
    const allRows = db.getAllScores();
    const total = allRows.length;

    if (total < MIN_RESPONSES) {
      return { available: false, totalResponses: total, minRequired: MIN_RESPONSES };
    }

    const benchmarks = {};

    DIMENSION_KEYS.forEach(key => {
      const colName = 'score_' + key;
      const allValues = allRows.map(r => r[colName]);
      benchmarks[key] = {
        percentile: calculatePercentile(scores[key], allValues),
        average: mean(allValues),
      };
    });

    const allOverall = allRows.map(r => r.score_overall);
    benchmarks.overall = {
      percentile: calculatePercentile(scores.overall, allOverall),
      average: mean(allOverall),
    };

    return { available: true, totalResponses: total, benchmarks };
  },

  getAggregates() {
    const allRows = db.getAllScores();
    const total = allRows.length;
    if (total === 0) return null;

    const result = { totalAssessments: total, dimensions: {} };

    DIMENSION_KEYS.forEach(key => {
      const colName = 'score_' + key;
      const values = allRows.map(r => r[colName]);
      const sorted = [...values].sort((a, b) => a - b);
      result.dimensions[key] = {
        average: mean(values),
        median: sorted[Math.floor(sorted.length / 2)],
        distribution: [
          values.filter(v => v < 1.5).length,
          values.filter(v => v >= 1.5 && v < 2.5).length,
          values.filter(v => v >= 2.5 && v < 3.5).length,
          values.filter(v => v >= 3.5 && v < 4.5).length,
          values.filter(v => v >= 4.5).length,
        ],
      };
    });

    const overallValues = allRows.map(r => r.score_overall);
    const sorted = [...overallValues].sort((a, b) => a - b);
    result.overall = {
      average: mean(overallValues),
      median: sorted[Math.floor(sorted.length / 2)],
      distribution: [
        overallValues.filter(v => v < 1.5).length,
        overallValues.filter(v => v >= 1.5 && v < 2.5).length,
        overallValues.filter(v => v >= 2.5 && v < 3.5).length,
        overallValues.filter(v => v >= 3.5 && v < 4.5).length,
        overallValues.filter(v => v >= 4.5).length,
      ],
    };

    return result;
  }
};
