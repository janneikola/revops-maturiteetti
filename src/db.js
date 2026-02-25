const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'revops.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS assessments (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
    ai_generated_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_assessments_created_at ON assessments(created_at);
  CREATE INDEX IF NOT EXISTS idx_assessments_overall ON assessments(score_overall);

  CREATE TABLE IF NOT EXISTS analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    assessment_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Prepared statements
const stmts = {
  insertAssessment: db.prepare(`
    INSERT INTO assessments (id, lead_name, lead_email, lead_company, lead_role,
      answers_json, score_strategy, score_process, score_data, score_tech,
      score_people, score_journey, score_overall, maturity_level)
    VALUES (@id, @lead_name, @lead_email, @lead_company, @lead_role,
      @answers_json, @score_strategy, @score_process, @score_data, @score_tech,
      @score_people, @score_journey, @score_overall, @maturity_level)
  `),
  getAssessment: db.prepare('SELECT * FROM assessments WHERE id = ?'),
  updateAi: db.prepare(`
    UPDATE assessments SET ai_analysis = ?, ai_action_plan = ?, ai_generated_at = datetime('now')
    WHERE id = ?
  `),
  insertEvent: db.prepare(`
    INSERT INTO analytics_events (event_type, assessment_id, metadata_json) VALUES (?, ?, ?)
  `),
};

module.exports = {
  insert(assessment) {
    stmts.insertAssessment.run({
      id: assessment.id,
      lead_name: assessment.lead_name || null,
      lead_email: assessment.lead_email || null,
      lead_company: assessment.lead_company || null,
      lead_role: assessment.lead_role || null,
      answers_json: JSON.stringify(assessment.answers),
      score_strategy: assessment.scores.strategy,
      score_process: assessment.scores.process,
      score_data: assessment.scores.data,
      score_tech: assessment.scores.tech,
      score_people: assessment.scores.people,
      score_journey: assessment.scores.journey,
      score_overall: assessment.scores.overall,
      maturity_level: assessment.maturityLevel,
    });
  },

  get(id) {
    return stmts.getAssessment.get(id);
  },

  updateAi(id, analysis, actionPlan) {
    stmts.updateAi.run(JSON.stringify(analysis), JSON.stringify(actionPlan), id);
  },

  getAllScores() {
    return db.prepare(`
      SELECT score_strategy, score_process, score_data, score_tech,
             score_people, score_journey, score_overall
      FROM assessments
    `).all();
  },

  getCount() {
    return db.prepare('SELECT COUNT(*) as count FROM assessments').get().count;
  },

  getStats() {
    const total = this.getCount();
    const avgScores = db.prepare(`
      SELECT
        ROUND(AVG(score_strategy), 1) as strategy,
        ROUND(AVG(score_process), 1) as process,
        ROUND(AVG(score_data), 1) as data,
        ROUND(AVG(score_tech), 1) as tech,
        ROUND(AVG(score_people), 1) as people,
        ROUND(AVG(score_journey), 1) as journey,
        ROUND(AVG(score_overall), 1) as overall
      FROM assessments
    `).get();

    const distribution = db.prepare(`
      SELECT
        SUM(CASE WHEN score_overall < 1.5 THEN 1 ELSE 0 END) as level1,
        SUM(CASE WHEN score_overall >= 1.5 AND score_overall < 2.5 THEN 1 ELSE 0 END) as level2,
        SUM(CASE WHEN score_overall >= 2.5 AND score_overall < 3.5 THEN 1 ELSE 0 END) as level3,
        SUM(CASE WHEN score_overall >= 3.5 AND score_overall < 4.5 THEN 1 ELSE 0 END) as level4,
        SUM(CASE WHEN score_overall >= 4.5 THEN 1 ELSE 0 END) as level5
      FROM assessments
    `).get();

    const recent = db.prepare(`
      SELECT id, created_at, lead_name, lead_company, lead_email, score_overall, maturity_level
      FROM assessments ORDER BY created_at DESC LIMIT 20
    `).all();

    const weekly = db.prepare(`
      SELECT
        strftime('%Y-W%W', created_at) as week,
        COUNT(*) as count,
        ROUND(AVG(score_overall), 1) as avg_overall
      FROM assessments
      GROUP BY week ORDER BY week DESC LIMIT 12
    `).all();

    return { total, avgScores, distribution, recent, weekly };
  },

  getAssessments(page, limit) {
    const offset = (page - 1) * limit;
    const items = db.prepare(`
      SELECT id, created_at, lead_name, lead_email, lead_company, lead_role,
             score_overall, maturity_level, score_strategy, score_process,
             score_data, score_tech, score_people, score_journey
      FROM assessments ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
    const total = this.getCount();
    return { items, total, page, pages: Math.ceil(total / limit) };
  },

  getAllForExport() {
    return db.prepare(`
      SELECT id, created_at, lead_name, lead_email, lead_company, lead_role,
             score_strategy, score_process, score_data, score_tech,
             score_people, score_journey, score_overall, maturity_level
      FROM assessments ORDER BY created_at DESC
    `).all();
  },

  trackEvent(type, assessmentId, metadata) {
    stmts.insertEvent.run(type, assessmentId || null, metadata ? JSON.stringify(metadata) : null);
  },

  getEventStats() {
    return db.prepare(`
      SELECT event_type, COUNT(*) as count
      FROM analytics_events
      GROUP BY event_type
    `).all();
  }
};
