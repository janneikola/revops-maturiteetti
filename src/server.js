require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

// API routes
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);

// Shareable results page with OG meta tags
app.get('/results/:id', (req, res) => {
  try {
    const db = require('./db');
    const assessment = db.get(req.params.id);
    const resultsPath = path.join(__dirname, '..', 'public', 'results.html');

    if (!assessment || !fs.existsSync(resultsPath)) {
      return res.redirect('/');
    }

    let html = fs.readFileSync(resultsPath, 'utf8');
    html = html.replace('{{OG_TITLE}}', 'RevOps Maturiteetti: ' + assessment.score_overall + '/5.0');
    html = html.replace('{{OG_DESC}}', assessment.maturity_level + ' \u2013 Organisaation RevOps-kypsyysarvio');
    html = html.replace('{{ASSESSMENT_ID}}', req.params.id);

    res.send(html);
  } catch (err) {
    console.error('Results page error:', err);
    res.redirect('/');
  }
});

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('RevOps Maturiteettikartoitus running on port ' + PORT);
});
