const Anthropic = require('@anthropic-ai/sdk');

const client = process.env.CLAUDE_API_KEY
  ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
  : null;

const DIMENSION_NAMES = {
  strategy: 'Strategia ja johtaminen',
  process: 'Prosessit',
  data: 'Data ja analytiikka',
  tech: 'Teknologia ja työkalut',
  people: 'Ihmiset ja kulttuuri',
  journey: 'Asiakaspolku',
};

const LEVEL_NAMES = {
  'Ad Hoc': 'Toiminta on satunnaista ja reaktiivista.',
  'Reagoiva': 'Tarve on tunnistettu, mutta toiminta on hajanaista.',
  'Määritelty': 'Prosessit on dokumentoitu ja yhteistyö alkanut.',
  'Hallittu': 'Data ohjaa päätöksiä ja automaatio on käytössä.',
  'Optimoitu': 'Tekoäly ja jatkuva optimointi ohjaavat toimintaa.',
};

function buildContext(assessment) {
  const answers = JSON.parse(assessment.answers_json);
  const dims = [
    { key: 'strategy', score: assessment.score_strategy },
    { key: 'process', score: assessment.score_process },
    { key: 'data', score: assessment.score_data },
    { key: 'tech', score: assessment.score_tech },
    { key: 'people', score: assessment.score_people },
    { key: 'journey', score: assessment.score_journey },
  ];

  const sorted = [...dims].sort((a, b) => a.score - b.score);
  const weakest = sorted.slice(0, 3);
  const strongest = sorted.slice(-2).reverse();

  let context = `Organisaatio: ${assessment.lead_company || 'Ei tiedossa'}\n`;
  context += `Rooli: ${assessment.lead_role || 'Ei tiedossa'}\n`;
  context += `Kokonaistulos: ${assessment.score_overall}/5.0 (${assessment.maturity_level})\n\n`;
  context += 'Dimensiokohtaiset tulokset:\n';
  dims.forEach(d => {
    context += `- ${DIMENSION_NAMES[d.key]}: ${d.score}/5.0\n`;
  });

  return { context, weakest, strongest, answers };
}

async function generateAnalysis(assessment) {
  if (!client) throw new Error('Claude API key not configured');

  const { context, weakest, strongest } = buildContext(assessment);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Olet Revenue Operations -asiantuntija. Analysoi seuraavan organisaation RevOps-maturiteettikartoituksen tulokset ja tuota JSON-muotoinen analyysi.

${context}

Tuota JSON seuraavassa muodossa (vastaa VAIN JSON:lla, ei muuta tekstiä):
{
  "narrative": "2-3 kappaleen yleisanalyysi organisaation RevOps-kypsyystasosta suomeksi. Ole konkreettinen ja käytännönläheinen.",
  "strengths": [
    {"dimension": "dimension_nimi", "insight": "Miksi tämä on vahvuus ja miten sitä voi hyödyntää"}
  ],
  "gaps": [
    {"dimension": "dimension_nimi", "risk": "Mikä riski tästä aiheutuu", "impact": "Konkreettinen vaikutus liiketoimintaan"}
  ],
  "recommendations": [
    {"priority": 1, "action": "Konkreettinen toimenpide", "rationale": "Miksi tämä on tärkeää juuri nyt"}
  ]
}

Vahvuudet (top 2): ${strongest.map(d => DIMENSION_NAMES[d.key] + ' (' + d.score + ')').join(', ')}
Heikkoudet (bottom 3): ${weakest.map(d => DIMENSION_NAMES[d.key] + ' (' + d.score + ')').join(', ')}

Anna 2 vahvuutta, 2-3 puutetta ja 3-4 suositusta. Käytä suomen kieltä.`
    }],
  });

  const text = response.content[0].text;
  return JSON.parse(text);
}

async function generateActionPlan(assessment) {
  if (!client) throw new Error('Claude API key not configured');

  const { context, weakest } = buildContext(assessment);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Olet Revenue Operations -konsultti. Luo 90 päivän toimintasuunnitelma organisaatiolle joka on tehnyt RevOps-maturiteettikartoituksen.

${context}

Heikoimmat osa-alueet joihin keskitytään:
${weakest.map(d => `- ${DIMENSION_NAMES[d.key]}: ${d.score}/5.0`).join('\n')}

Tuota JSON seuraavassa muodossa (vastaa VAIN JSON:lla, ei muuta tekstiä):
{
  "summary": "Lyhyt yhteenveto toimintasuunnitelman fokuksesta",
  "weakestDimensions": ["dimension1", "dimension2"],
  "phases": [
    {
      "name": "Vaihe 1: Perusta (Viikot 1-4)",
      "focus": "Mihin keskitytään",
      "steps": [
        {"week": "1-2", "action": "Konkreettinen toimenpide", "detail": "Tarkempi kuvaus", "dimension": "dimension_nimi"},
        {"week": "3-4", "action": "Konkreettinen toimenpide", "detail": "Tarkempi kuvaus", "dimension": "dimension_nimi"}
      ]
    },
    {
      "name": "Vaihe 2: Kehitys (Viikot 5-8)",
      "focus": "Mihin keskitytään",
      "steps": [...]
    },
    {
      "name": "Vaihe 3: Optimointi (Viikot 9-12)",
      "focus": "Mihin keskitytään",
      "steps": [...]
    }
  ],
  "expectedOutcome": "Mitä 90 päivän jälkeen pitäisi olla saavutettu"
}

Ole konkreettinen ja käytännönläheinen. Käytä suomen kieltä. Jokaisessa vaiheessa 2-3 askelta.`
    }],
  });

  const text = response.content[0].text;
  return JSON.parse(text);
}

module.exports = { generateAnalysis, generateActionPlan };
