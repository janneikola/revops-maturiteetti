process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: PORT });
});

// Middleware
app.use(express.json());

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Wait for DB before handling API requests
app.use('/api', async (req, res, next) => {
  try {
    await db.ready;
    next();
  } catch (err) {
    res.status(503).json({ error: 'Database not ready' });
  }
});

// API routes
app.use('/api', require('./routes/api'));
app.use('/api/admin', require('./routes/admin'));

// Shareable results page with OG meta tags
app.get('/results/:id', async (req, res) => {
  try {
    await db.ready;
    const assessment = await db.get(req.params.id);
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

// Start after DB is ready
db.ready.then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('RevOps Maturiteettikartoitus running on port ' + PORT);
  });
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
