const express = require('express');
const db = require('../db');
const { adminAuth, createToken, ADMIN_PASSWORD } = require('../middleware/auth');

const router = express.Router();

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = createToken();
  res.json({ token });
});

// All routes below require auth
router.use(adminAuth);

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  try {
    const stats = db.getStats();
    const events = db.getEventStats();
    res.json({ ...stats, events });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/assessments
router.get('/assessments', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const data = db.getAssessments(page, limit);
    res.json(data);
  } catch (err) {
    console.error('Admin assessments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/export
router.get('/export', (req, res) => {
  try {
    const rows = db.getAllForExport();
    const headers = [
      'id', 'created_at', 'lead_name', 'lead_email', 'lead_company', 'lead_role',
      'score_strategy', 'score_process', 'score_data', 'score_tech',
      'score_people', 'score_journey', 'score_overall', 'maturity_level'
    ];

    let csv = headers.join(';') + '\n';
    rows.forEach(row => {
      csv += headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = String(val);
        return str.includes(';') || str.includes('"') || str.includes('\n')
          ? '"' + str.replace(/"/g, '""') + '"'
          : str;
      }).join(';') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=revops-assessments.csv');
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  } catch (err) {
    console.error('Admin export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
