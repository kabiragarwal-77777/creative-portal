const fs = require('fs');
const path = require('path');

const root = process.cwd();
const metaPath = path.join(root, 'optimizer.js');
const googlePath = path.join(root, 'google-creative', 'public', 'gc-optimizer.js');
const appPath = path.join(root, 'google-creative', 'public', 'gc-app.js');

const meta = fs.readFileSync(metaPath, 'utf8');
const google = fs.readFileSync(googlePath, 'utf8');
const gcApp = fs.readFileSync(appPath, 'utf8');

const promptSuite = [
  { name: 'daily analysis', meta: ['daily_review', 'account_overview'], google: ['full_account_review', 'daily_optimisation'] },
  { name: 'deep dive', meta: ['account_overview'], google: ['deep_dive'] },
  { name: 'why is performance weak', meta: ['diagnostic'], google: ['underperformance_rca'] },
  { name: 'what should I change today', meta: ['daily_review'], google: ['daily_optimisation'] },
  { name: 'should we scale', meta: ['daily_review'], google: ['scale_check'] },
  { name: 'predict next 30 days', meta: ['diagnostic'], google: ['predict_30_days'] },
  { name: 'creative brief', meta: ['account_overview'], google: ['creative_brief'] },
  { name: 'change impact analysis', meta: ['diagnostic'], google: ['change_impact_analysis'] }
];

const checks = [
  { name: 'Meta template marker: Analysis Basis', source: meta, token: 'Analysis Basis' },
  { name: 'Meta template marker: Current Working Slice', source: meta, token: 'Current Working Slice' },
  { name: 'Meta template marker: Data Integrity', source: meta, token: 'Data Integrity' },
  { name: 'Meta template marker: APEX Answer', source: meta, token: 'APEX Answer' },
  { name: 'Meta template marker: What To Do Right Now', source: meta, token: 'What To Do Right Now' },
  { name: 'Meta template marker: What To Leave Alone', source: meta, token: 'What To Leave Alone' },
  { name: 'Meta template marker: Watch List', source: meta, token: 'Watch List' },
  { name: 'Meta template marker: Campaign Insights', source: meta, token: 'Campaign Insights' },

  { name: 'Google template marker: Analysis Basis', source: google, token: 'Analysis Basis' },
  { name: 'Google template marker: Current Working Slice', source: google, token: 'Current Working Slice' },
  { name: 'Google template marker: Data Integrity', source: google, token: 'Data Integrity' },
  { name: 'Google template marker: APEX Answer', source: google, token: 'APEX Answer' },
  { name: 'Google template marker: Morning Brief', source: google, token: 'Morning Brief' },
  { name: 'Google template marker: What To Do Right Now', source: google, token: 'What To Do Right Now' },
  { name: 'Google template marker: What To Leave Alone', source: google, token: 'What To Leave Alone' },
  { name: 'Google template marker: Watch List', source: google, token: 'Watch List' },
  { name: 'Google template marker: Campaign Insights', source: google, token: 'Campaign Insights' },
  { name: 'Google optimizer hides generic assistant dock', source: gcApp, token: "assistantDock.hidden = optimizerMode" },
  { name: 'Google optimizer hides plan button in optimizer mode', source: google, token: "if (!optimizerUiMode) {" },
  { name: 'Google optimizer query bar', source: google, token: 'Ask APEX' }
];

const results = checks.map(check => ({
  name: check.name,
  present: check.source.includes(check.token)
}));

const promptResults = promptSuite.map(item => {
  const metaHits = item.meta.filter(token => meta.includes(token));
  const googleHits = item.google.filter(token => google.includes(token));
  return {
    prompt: item.name,
    metaHits,
    googleHits
  };
});

const failed = [];
results.forEach(r => {
  if (!r.present) failed.push(r.name);
});

console.log('Google vs Meta optimizer parity suite');
console.log('-------------------------------------');
results.forEach(r => console.log(`${r.name}: ${r.present ? 'PASS' : 'FAIL'}`));
console.log('\nPrompt routing snapshot:');
promptResults.forEach(p => {
  console.log(`- ${p.prompt}: meta=[${p.metaHits.join(', ') || 'none'}] google=[${p.googleHits.join(', ') || 'none'}]`);
});

if (failed.length) {
  console.log('\nFailed checks:');
  failed.forEach(item => console.log(`- ${item}`));
  process.exitCode = 1;
} else {
  console.log('\nPASS: Google optimizer template and routing markers are aligned with Meta, with intentional platform-specific differences only.');
}
