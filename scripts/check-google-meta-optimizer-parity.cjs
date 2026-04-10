const fs = require('fs');
const path = require('path');

const root = process.cwd();
const metaPath = path.join(root, 'optimizer.js');
const googlePath = path.join(root, 'google-creative', 'public', 'gc-optimizer.js');

const meta = fs.readFileSync(metaPath, 'utf8');
const google = fs.readFileSync(googlePath, 'utf8');

const checks = [
  { name: 'Analysis Basis section', token: 'Analysis Basis' },
  { name: 'Current Working Slice section', token: 'Current Working Slice' },
  { name: 'Data Integrity section', token: 'Data Integrity' },
  { name: 'APEX Answer label', token: 'APEX Answer' },
  { name: 'What To Do Right Now section', token: 'What To Do Right Now' },
  { name: 'What To Leave Alone section', token: 'What To Leave Alone' },
  { name: 'Watch List section', token: 'Watch List' },
  { name: 'Campaign Insights section', token: 'Campaign Insights' },
  { name: 'Ask button copy', token: 'Ask APEX' },
  { name: 'Back button copy', token: '← Back' }
];

const results = checks.map(check => ({
  name: check.name,
  meta: meta.includes(check.token),
  google: google.includes(check.token)
}));

const failed = results.filter(r => r.meta && !r.google);

console.log('Meta/Google optimizer template parity check');
console.log('------------------------------------------');
results.forEach(r => {
  console.log(`${r.name}: meta=${r.meta ? 'yes' : 'no'} google=${r.google ? 'yes' : 'no'}`);
});

if (failed.length) {
  console.log('\nMissing in Google:');
  failed.forEach(f => console.log(`- ${f.name}`));
  process.exitCode = 1;
} else {
  console.log('\nPASS: Google contains all required Meta template markers.');
}
