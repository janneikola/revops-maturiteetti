const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const benchmark = require('../services/benchmark');
const claude = require('../services/claude');

const router = express.Router();

// Scoring logic (mirrors client-side)
const DIMENSION_IDS = ['strategy', 'process', 'data', 'tech', 'people', 'journey'];

const LEVELS = [
  { min: 1.0, max: 1.4, name: 'Ad Hoc' },
  { min: 1.5, max: 2.4, name: 'Reagoiva' },
  { min: 2.5, max: 3.4, name: 'M\u00e4\u00e4ritelty' },
  { min: 3.5, max: 4.4, name: 'Hallittu' },
  { min: 4.5, max: 5.0, name: 'Optimoitu' },
];

function getLevel(score) {
  return LEVELS.find(l => score >= l.min && score <= l.max) || LEVELS[0];
}

function calculateScores(answers) {
  const scores = {};
  DIMENSION_IDS.forEach(dimId => {
    let sum = 0, count = 0;
    for (let qi = 0; qi < 3; qi++) {
      const val = answers[dimId + '_' + qi];
      if (val !== undefined) { sum += val; count++; }
    }
    scores[dimId] = count > 0 ? Math.round((sum / count) * 10) / 10 : 1;
  });
  const vals = Object.values(scores);
  scores.overall = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  return scores;
}

// POST /api/assessments - Submit assessment
router.post('/assessments', async (req, res) => {
  try {
    const { answers, lead } = req.body;
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Missing answers' });
    }

    const scores = calculateScores(answers);
    const level = getLevel(scores.overall);
    const id = uuidv4();

    await db.insert({
      id,
      answers,
      scores,
      maturityLevel: level.name,
      lead_name: lead?.name,
      lead_email: lead?.email,
      lead_company: lead?.company,
      lead_role: lead?.role,
    });

    db.trackEvent('assessment_completed', id).catch(e => console.error('Event tracking failed:', e));

    const benchmarkData = await benchmark.getBenchmarks(scores);

    // Trigger AI generation in background
    if (process.env.CLAUDE_API_KEY) {
      db.get(id).then(assessment => {
        if (!assessment) return;
        Promise.all([
          claude.generateAnalysis(assessment).catch(e => {
            console.error('AI analysis failed:', e.message);
            return null;
          }),
          claude.generateActionPlan(assessment).catch(e => {
            console.error('AI action plan failed:', e.message);
            return null;
          }),
        ]).then(([analysis, actionPlan]) => {
          if (analysis || actionPlan) {
            db.updateAi(id, analysis, actionPlan);
          }
        });
      });
    }

    res.json({
      id,
      scores,
      level,
      benchmark: benchmarkData,
      shareUrl: '/results/' + id,
    });
  } catch (err) {
    console.error('Assessment submission error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/assessments/:id - Get assessment results
router.get('/assessments/:id', async (req, res) => {
  try {
    const row = await db.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const scores = {
      strategy: row.score_strategy,
      process: row.score_process,
      data: row.score_data,
      tech: row.score_tech,
      people: row.score_people,
      journey: row.score_journey,
      overall: row.score_overall,
    };

    const benchmarkData = await benchmark.getBenchmarks(scores);

    res.json({
      id: row.id,
      createdAt: row.created_at,
      scores,
      level: getLevel(row.score_overall),
      maturityLevel: row.maturity_level,
      benchmark: benchmarkData,
      shareUrl: '/results/' + row.id,
      lead: {
        name: row.lead_name,
        company: row.lead_company,
      },
    });
  } catch (err) {
    console.error('Get assessment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/assessments/:id/ai - Get AI content
router.get('/assessments/:id/ai', async (req, res) => {
  try {
    const row = await db.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    if (row.ai_generated_at) {
      return res.json({
        status: 'ready',
        analysis: row.ai_analysis ? JSON.parse(row.ai_analysis) : null,
        actionPlan: row.ai_action_plan ? JSON.parse(row.ai_action_plan) : null,
      });
    }

    res.json({ status: 'generating' });
  } catch (err) {
    console.error('Get AI content error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/assessments/:id/generate-ai - Trigger AI generation
router.post('/assessments/:id/generate-ai', async (req, res) => {
  try {
    const row = await db.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.ai_generated_at) return res.json({ status: 'ready' });
    if (!process.env.CLAUDE_API_KEY) return res.json({ status: 'unavailable' });

    Promise.all([
      claude.generateAnalysis(row).catch(() => null),
      claude.generateActionPlan(row).catch(() => null),
    ]).then(([analysis, actionPlan]) => {
      if (analysis || actionPlan) {
        db.updateAi(row.id, analysis, actionPlan);
      }
    });

    res.json({ status: 'generating' });
  } catch (err) {
    console.error('Generate AI error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/benchmarks - Public benchmark data
router.get('/benchmarks', async (req, res) => {
  try {
    const data = await benchmark.getAggregates();
    res.json(data || { totalAssessments: 0 });
  } catch (err) {
    console.error('Benchmarks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/events - Track analytics events
router.post('/events', async (req, res) => {
  try {
    const { type, assessmentId, metadata } = req.body;
    if (!type) return res.status(400).json({ error: 'Missing event type' });
    await db.trackEvent(type, assessmentId, metadata);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
