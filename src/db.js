const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idle_timeout: 20,
});

// Create tables
const ready = (async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lead_name TEXT,
      lead_email TEXT,
      lead_company TEXT,
      lead_role TEXT,
      answers_json TEXT NOT NULL,
      score_strategy REAL NOT NULL,
      score_process REAL NOT NULL,
      score_data REAL NOT NULL,
      score_tech REAL NOT NULL,
      score_people REAL NOT NULL,
      score_journey REAL NOT NULL,
      score_overall REAL NOT NULL,
      maturity_level TEXT NOT NULL,
      ai_analysis TEXT,
      ai_action_plan TEXT,
      ai_generated_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_assessments_created_at ON assessments(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_assessments_overall ON assessments(score_overall)`;
  await sql`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      assessment_id TEXT,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('Database tables ready');
})().catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});

module.exports = {
  ready,

  async insert(assessment) {
    await sql`
      INSERT INTO assessments (id, lead_name, lead_email, lead_company, lead_role,
        answers_json, score_strategy, score_process, score_data, score_tech,
        score_people, score_journey, score_overall, maturity_level)
      VALUES (${assessment.id}, ${assessment.lead_name || null}, ${assessment.lead_email || null},
        ${assessment.lead_company || null}, ${assessment.lead_role || null},
        ${JSON.stringify(assessment.answers)}, ${assessment.scores.strategy},
        ${assessment.scores.process}, ${assessment.scores.data}, ${assessment.scores.tech},
        ${assessment.scores.people}, ${assessment.scores.journey}, ${assessment.scores.overall},
        ${assessment.maturityLevel})
    `;
  },

  async get(id) {
    const rows = await sql`SELECT * FROM assessments WHERE id = ${id}`;
    return rows[0] || null;
  },

  async updateAi(id, analysis, actionPlan) {
    await sql`
      UPDATE assessments
      SET ai_analysis = ${JSON.stringify(analysis)},
          ai_action_plan = ${JSON.stringify(actionPlan)},
          ai_generated_at = NOW()
      WHERE id = ${id}
    `;
  },

  async getAllScores() {
    return await sql`
      SELECT score_strategy, score_process, score_data, score_tech,
             score_people, score_journey, score_overall
      FROM assessments
    `;
  },

  async getCount() {
    const rows = await sql`SELECT COUNT(*)::int as count FROM assessments`;
    return rows[0].count;
  },

  async getStats() {
    const total = await this.getCount();
    const avgRows = await sql`
      SELECT
        ROUND(AVG(score_strategy)::numeric, 1)::float as strategy,
        ROUND(AVG(score_process)::numeric, 1)::float as process,
        ROUND(AVG(score_data)::numeric, 1)::float as data,
        ROUND(AVG(score_tech)::numeric, 1)::float as tech,
        ROUND(AVG(score_people)::numeric, 1)::float as people,
        ROUND(AVG(score_journey)::numeric, 1)::float as journey,
        ROUND(AVG(score_overall)::numeric, 1)::float as overall
      FROM assessments
    `;
    const avgScores = avgRows[0] || null;

    const distRows = await sql`
      SELECT
        SUM(CASE WHEN score_overall < 1.5 THEN 1 ELSE 0 END)::int as level1,
        SUM(CASE WHEN score_overall >= 1.5 AND score_overall < 2.5 THEN 1 ELSE 0 END)::int as level2,
        SUM(CASE WHEN score_overall >= 2.5 AND score_overall < 3.5 THEN 1 ELSE 0 END)::int as level3,
        SUM(CASE WHEN score_overall >= 3.5 AND score_overall < 4.5 THEN 1 ELSE 0 END)::int as level4,
        SUM(CASE WHEN score_overall >= 4.5 THEN 1 ELSE 0 END)::int as level5
      FROM assessments
    `;
    const distribution = distRows[0] || null;

    const recent = await sql`
      SELECT id, created_at, lead_name, lead_company, lead_email, score_overall, maturity_level
      FROM assessments ORDER BY created_at DESC LIMIT 20
    `;

    const weekly = await sql`
      SELECT
        TO_CHAR(created_at, 'IYYY-"W"IW') as week,
        COUNT(*)::int as count,
        ROUND(AVG(score_overall)::numeric, 1)::float as avg_overall
      FROM assessments
      GROUP BY week ORDER BY week DESC LIMIT 12
    `;

    return { total, avgScores, distribution, recent, weekly };
  },

  async getAssessments(page, limit) {
    const offset = (page - 1) * limit;
    const items = await sql`
      SELECT id, created_at, lead_name, lead_email, lead_company, lead_role,
             score_overall, maturity_level, score_strategy, score_process,
             score_data, score_tech, score_people, score_journey
      FROM assessments ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
    const total = await this.getCount();
    return { items, total, page, pages: Math.ceil(total / limit) };
  },

  async getAllForExport() {
    return await sql`
      SELECT id, created_at, lead_name, lead_email, lead_company, lead_role,
             score_strategy, score_process, score_data, score_tech,
             score_people, score_journey, score_overall, maturity_level
      FROM assessments ORDER BY created_at DESC
    `;
  },

  async trackEvent(type, assessmentId, metadata) {
    await sql`
      INSERT INTO analytics_events (event_type, assessment_id, metadata_json)
      VALUES (${type}, ${assessmentId || null}, ${metadata ? JSON.stringify(metadata) : null})
    `;
  },

  async getEventStats() {
    return await sql`
      SELECT event_type, COUNT(*)::int as count
      FROM analytics_events
      GROUP BY event_type
    `;
  }
};
