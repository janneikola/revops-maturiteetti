const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'revops.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

let db = null;

// Initialize database
async function init() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
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
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_assessments_created_at ON assessments(created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_assessments_overall ON assessments(score_overall)');
  db.run(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      assessment_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  save();
  return db;
}

function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

// Helper: convert sql.js result to array of objects
function queryAll(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql, params) {
  db.run(sql, params);
  save();
}

// Initialize on require
const ready = init().catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});

module.exports = {
  ready,

  insert(assessment) {
    run(`
      INSERT INTO assessments (id, lead_name, lead_email, lead_company, lead_role,
        answers_json, score_strategy, score_process, score_data, score_tech,
        score_people, score_journey, score_overall, maturity_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      assessment.id,
      assessment.lead_name || null,
      assessment.lead_email || null,
      assessment.lead_company || null,
      assessment.lead_role || null,
      JSON.stringify(assessment.answers),
      assessment.scores.strategy,
      assessment.scores.process,
      assessment.scores.data,
      assessment.scores.tech,
      assessment.scores.people,
      assessment.scores.journey,
      assessment.scores.overall,
      assessment.maturityLevel,
    ]);
  },

  get(id) {
    return queryOne('SELECT * FROM assessments WHERE id = ?', [id]);
  },

  updateAi(id, analysis, actionPlan) {
    run(
      "UPDATE assessments SET ai_analysis = ?, ai_action_plan = ?, ai_generated_at = datetime('now') WHERE id = ?",
      [JSON.stringify(analysis), JSON.stringify(actionPlan), id]
    );
  },

  getAllScores() {
    return queryAll(`
      SELECT score_strategy, score_process, score_data, score_tech,
             score_people, score_journey, score_overall
      FROM assessments
    `);
  },

  getCount() {
    const row = queryOne('SELECT COUNT(*) as count FROM assessments');
    return row ? row.count : 0;
  },

  getStats() {
    const total = this.getCount();
    const avgScores = queryOne(`
      SELECT
        ROUND(AVG(score_strategy), 1) as strategy,
        ROUND(AVG(score_process), 1) as process,
        ROUND(AVG(score_data), 1) as data,
        ROUND(AVG(score_tech), 1) as tech,
        ROUND(AVG(score_people), 1) as people,
        ROUND(AVG(score_journey), 1) as journey,
        ROUND(AVG(score_overall), 1) as overall
      FROM assessments
    `);

    const distribution = queryOne(`
      SELECT
        SUM(CASE WHEN score_overall < 1.5 THEN 1 ELSE 0 END) as level1,
        SUM(CASE WHEN score_overall >= 1.5 AND score_overall < 2.5 THEN 1 ELSE 0 END) as level2,
        SUM(CASE WHEN score_overall >= 2.5 AND score_overall < 3.5 THEN 1 ELSE 0 END) as level3,
        SUM(CASE WHEN score_overall >= 3.5 AND score_overall < 4.5 THEN 1 ELSE 0 END) as level4,
        SUM(CASE WHEN score_overall >= 4.5 THEN 1 ELSE 0 END) as level5
      FROM assessments
    `);

    const recent = queryAll(`
      SELECT id, created_at, lead_name, lead_company, lead_email, score_overall, maturity_level
      FROM assessments ORDER BY created_at DESC LIMIT 20
    `);

    const weekly = queryAll(`
      SELECT
        strftime('%Y-W%W', created_at) as week,
        COUNT(*) as count,
        ROUND(AVG(score_overall), 1) as avg_overall
      FROM assessments
      GROUP BY week ORDER BY week DESC LIMIT 12
    `);

    return { total, avgScores, distribution, recent, weekly };
  },

  getAssessments(page, limit) {
    const offset = (page - 1) * limit;
    const items = queryAll(`
      SELECT id, created_at, lead_name, lead_email, lead_company, lead_role,
             score_overall, maturity_level, score_strategy, score_process,
             score_data, score_tech, score_people, score_journey
      FROM assessments ORDER BY created_at DESC LIMIT ? OFFSET ?
    `, [limit, offset]);
    const total = this.getCount();
    return { items, total, page, pages: Math.ceil(total / limit) };
  },

  getAllForExport() {
    return queryAll(`
      SELECT id, created_at, lead_name, lead_email, lead_company, lead_role,
             score_strategy, score_process, score_data, score_tech,
             score_people, score_journey, score_overall, maturity_level
      FROM assessments ORDER BY created_at DESC
    `);
  },

  trackEvent(type, assessmentId, metadata) {
    run(
      'INSERT INTO analytics_events (event_type, assessment_id, metadata_json) VALUES (?, ?, ?)',
      [type, assessmentId || null, metadata ? JSON.stringify(metadata) : null]
    );
  },

  getEventStats() {
    return queryAll(`
      SELECT event_type, COUNT(*) as count
      FROM analytics_events
      GROUP BY event_type
    `);
  }
};
