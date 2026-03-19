const fs = require('fs');

// Read Agent 0 base
let html = fs.readFileSync('C:/Users/Dell/Desktop/creative-portal/agent0_raw.html', 'utf8');

// Read each agent's content file
const agents = [1,2,3,4,5,6,7,8,9,10];
const agentContent = {};
for (const n of agents) {
  const path = `C:/Users/Dell/Desktop/creative-portal/agent${n}_content.html`;
  if (fs.existsSync(path)) {
    agentContent[n] = fs.readFileSync(path, 'utf8');
    console.log(`Agent ${n}: ${agentContent[n].length} chars`);
  } else {
    console.log(`Agent ${n}: FILE MISSING`);
    agentContent[n] = `<!-- Agent ${n} content missing -->`;
  }
}

// Replace placeholders
const replacements = [
  ['<!-- AGENT 1 PLACEHOLDER -->', agentContent[1]],
  ['<!-- AGENT 2 PLACEHOLDER -->', agentContent[2]],
  ['<!-- AGENT 3 PLACEHOLDER -->', agentContent[3]],
  ['<!-- AGENT 4 PLACEHOLDER -->', agentContent[4]],
  ['<!-- AGENT 5 PLACEHOLDER -->', agentContent[5]],
  ['<!-- AGENT 6 PLACEHOLDER -->', agentContent[6]],
  ['<!-- AGENT 7 PLACEHOLDER -->', agentContent[7]],
  ['<!-- AGENT 8 PLACEHOLDER -->', agentContent[8]],
  ['<!-- AGENT 9 PLACEHOLDER -->', agentContent[9]],
  ['<!-- AGENT 10 PLACEHOLDER -->', agentContent[10]],
];

for (const [placeholder, content] of replacements) {
  if (html.includes(placeholder)) {
    html = html.replace(placeholder, content);
    console.log(`Replaced: ${placeholder.substring(0,30)}`);
  } else {
    console.log(`NOT FOUND: ${placeholder.substring(0,30)}`);
  }
}

fs.writeFileSync('C:/Users/Dell/Desktop/creative-portal/univest_ci_portal.html', html, 'utf8');
console.log(`\nFinal file: ${html.length} chars`);
console.log('Done!');
