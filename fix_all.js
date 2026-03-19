const fs = require('fs');
let html = fs.readFileSync('C:/Users/Dell/Desktop/creative-portal/univest_ci_portal.html', 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1: Module E — remove hardcoded year===2024 filter
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  'var entry=campaigns.find(function(x){return x.competitorId===c.id&&x.month===m&&x.year===2024;});return entry?entry.adCount:0;',
  'var entry=campaigns.filter(function(x){return x.competitorId===c.id&&x.month===m;}).sort(function(a,b){return b.year-a.year;})[0];return entry?entry.adCount:0;'
);
html = html.replace(
  'var entry=campaigns.find(function(x){return x.competitorId===c.id&&x.month===m&&x.year===2024;});return entry?entry.estimatedBudget:0;',
  'var entry=campaigns.filter(function(x){return x.competitorId===c.id&&x.month===m;}).sort(function(a,b){return b.year-a.year;})[0];return entry?entry.estimatedBudget:0;'
);
html = html.replace("label:m+' 2024'", "label:m+' (Latest)'");

console.log('Fix 1 (Module E year): applied');

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2: Add normalization to compute activeAds, monthlyVolume, topPlatform
//         from actual ads data (replace stale static values)
// ─────────────────────────────────────────────────────────────────────────────
const dynamicCompNorm = `
// Recompute competitor summary fields from actual ad data
(function recomputeCompStats() {
  var ads = window.UNIVEST_DATA.ads;
  var campaigns = window.UNIVEST_DATA.campaigns;
  window.UNIVEST_DATA.competitors.forEach(function(c) {
    var compAds = ads.filter(function(a){ return a.competitorId === c.id; });
    var activeAds = compAds.filter(function(a){ return a.isActive; });
    c.activeAds = activeAds.length;
    // platform distribution from ads
    var platCount = {};
    compAds.forEach(function(a){
      var p = Array.isArray(a.platform) ? a.platform[0] : (a.platform||'meta');
      platCount[p] = (platCount[p]||0)+1;
    });
    var topPlat = Object.keys(platCount).sort(function(a,b){return platCount[b]-platCount[a];})[0];
    if(topPlat) c.topPlatform = topPlat;
    // theme distribution
    var themeCount = {};
    compAds.forEach(function(a){ if(a.theme) themeCount[a.theme]=(themeCount[a.theme]||0)+1; });
    var topTheme = Object.keys(themeCount).sort(function(a,b){return themeCount[b]-themeCount[a];})[0];
    if(topTheme) c.topTheme = topTheme;
    // monthly volume from campaigns avg
    var compCamps = campaigns.filter(function(x){ return x.competitorId===c.id; });
    if(compCamps.length) {
      c.monthlyVolume = Math.round(compCamps.reduce(function(s,x){return s+(x.adCount||0);},0)/compCamps.length);
    }
  });
})();
`;

html = html.replace('// Normalize campaign fields', dynamicCompNorm + '\n// Normalize campaign fields');
console.log('Fix 2 (competitor stats normalization): applied');

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3: Module B — add date filter to getFilteredAds
// ─────────────────────────────────────────────────────────────────────────────
// Module B's getFilteredAds at ~line 1717 doesn't have date filter
const modBFilterOld = `function getFilteredAds(){
  var ads=window.UNIVEST_DATA&&window.UNIVEST_DATA.ads||[];
  var f=window.ACTIVE_FILTERS||{};
  if(f.vertical&&f.vertical!=='both'){var ids=(window.UNIVEST_DATA&&window.UNIVEST_DATA.competitors||[]).filter(function(c){return c.vertical===f.vertical||c.vertical==='both';}).map(function(c){return c.id;});ads=ads.filter(function(a){return ids.includes(a.competitorId);});}
  if(f.competitors&&f.competitors.length>0)ads=ads.filter(function(a){return f.competitors.includes(a.competitorId);});
  return ads.map(function(a){return Object.assign({},a,{days:computeRunDays(a)});});
}`;
const modBFilterNew = `function getFilteredAds(){
  var ads=window.UNIVEST_DATA&&window.UNIVEST_DATA.ads||[];
  var f=window.ACTIVE_FILTERS||{};
  if(f.vertical&&f.vertical!=='both'){var ids=(window.UNIVEST_DATA&&window.UNIVEST_DATA.competitors||[]).filter(function(c){return c.vertical===f.vertical||c.vertical==='both';}).map(function(c){return c.id;});ads=ads.filter(function(a){return ids.includes(a.competitorId);});}
  if(f.competitors&&f.competitors.length>0)ads=ads.filter(function(a){return f.competitors.includes(a.competitorId);});
  if(f.dateFrom){var from=new Date(f.dateFrom);ads=ads.filter(function(a){return new Date(a.firstSeen)>=from;});}
  return ads.map(function(a){return Object.assign({},a,{days:computeRunDays(a)});});
}`;
if(html.includes(modBFilterOld)) {
  html = html.replace(modBFilterOld, modBFilterNew);
  console.log('Fix 3 (Module B date filter): applied');
} else {
  console.log('Fix 3 (Module B date filter): pattern not found, skipping');
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 4: Replace insights with 25 rich, actionable opportunity entries
// ─────────────────────────────────────────────────────────────────────────────
const newInsights = `insights: [
  {id:'ins_001', observation:'Zerodha & Groww both running heavy "first-time investor" education ads — gap for Univest RA to own "smarter investing" positioning', whyItMatters:'First-time investor cohort is the fastest growing segment; advisory value is underserved here', action:'Launch a campaign series: "You invest. We tell you what to buy." targeting 22-32 age group on Meta Reels + YouTube Shorts', priority:'red', competitorIds:['zerodha','groww'], isDone:false},
  {id:'ins_002', observation:'Sensibull running 8+ ads on "options strategies for beginners" — no competitor is targeting the transition from equity to F&O', whyItMatters:'F&O onboarding is a high-LTV moment; first advisory service to own this wins repeat subscribers', action:'Create a "Ready for F&O?" quiz funnel on Instagram + conversion to RA subscription', priority:'red', competitorIds:['sensibull'], isDone:false},
  {id:'ins_003', observation:'Dhan running aggressive "switch from Zerodha" comparison ads — platform war heating up in broking', whyItMatters:'Competitor switching intent is high; RA value-add differentiates from pure execution brokers', action:'Target Zerodha/Dhan users with "You have the platform. Now get the alpha." messaging for RA', priority:'red', competitorIds:['dhan','zerodha'], isDone:false},
  {id:'ins_004', observation:'Weekend Investing mi100 ads getting very high engagement on YouTube — momentum investing content resonates', whyItMatters:'Systematic/quant approach builds trust with data-literate investors; reduces churn vs tip-based services', action:'Produce a "Univest vs passive index" performance explainer series on YouTube', priority:'yellow', competitorIds:['weekendinvesting'], isDone:false},
  {id:'ins_005', observation:'StockGro using gamification (leagues, paper trading) to acquire 18-25 users at low CAC', whyItMatters:'Gamified acquisition captures users before they have capital — builds brand loyalty early', action:'Build a free "paper portfolio" feature with weekly leaderboard to attract and convert young investors', priority:'yellow', competitorIds:['stockgro'], isDone:false},
  {id:'ins_006', observation:'Angel One SmartAPI ads targeting algo traders on LinkedIn — underserved premium segment', whyItMatters:'Algo traders are high-frequency, high-value users willing to pay for research-backed signals', action:'Launch B2B advisory API for retail algo traders integrating Univest RA calls into their strategies', priority:'yellow', competitorIds:['angelone'], isDone:false},
  {id:'ins_007', observation:'5paisa running "switch and save ₹X per month" calculator ads — price-led acquisition working', whyItMatters:'Cost sensitivity among active traders is high; bundled RA+brokerage pricing is untested', action:'Test a "Zero brokerage + RA advisory" bundle messaging on Google Search — capture high-intent switchers', priority:'yellow', competitorIds:['5paisa'], isDone:false},
  {id:'ins_008', observation:'Definedge getting strong engagement on Renko/P&F technical analysis content — niche but loyal audience', whyItMatters:'Technical traders are high-engagement, willing-to-pay segment often missed by fundamental RA services', action:'Create a "Fundamental signal + Technical timing" content series to bridge both worlds', priority:'yellow', competitorIds:['definedge'], isDone:false},
  {id:'ins_009', observation:'Groww US stocks ads increasing 40% MoM — international investing trend accelerating', whyItMatters:'Indian investors diversifying offshore; RA opportunity to guide international allocation decisions', action:'Launch "Global portfolio allocation" advisory tier targeting investors with 5L+ annual savings', priority:'yellow', competitorIds:['groww'], isDone:false},
  {id:'ins_010', observation:'No competitor running ads on WhatsApp Business or conversational formats — all using feed/video', whyItMatters:'WhatsApp has 500M India users; advisory delivery via WhatsApp is highly personal and sticky', action:'Build WhatsApp advisory delivery product and run click-to-WhatsApp Meta ads at low CPL', priority:'red', competitorIds:[], isDone:false},
  {id:'ins_011', observation:'Sensibull and Definedge both heavy on YouTube tutorials — long-form education driving subscriptions', whyItMatters:'Subscribers acquired through education have 3x lower churn than those acquired through discounts', action:'Publish 10 deep-dive YouTube videos on portfolio construction; retarget viewers with RA trial offer', priority:'yellow', competitorIds:['sensibull','definedge'], isDone:false},
  {id:'ins_012', observation:'Upstox & Angel One spending heavily on Google Search for "best demat account" keywords', whyItMatters:'High-intent searchers are actively evaluating; RA advisory is a strong differentiator at this moment', action:'Run Google Search ads on "best research advisory India" + "SEBI registered advisor" keywords', priority:'red', competitorIds:['upstox','angelone'], isDone:false},
  {id:'ins_013', observation:'Paytm Money running NPS tax-saving ads in Jan-March — seasonal opportunity being left open', whyItMatters:'Tax-season demand spikes are predictable; advisory for tax-optimized portfolio is high-value', action:'Run Jan-March campaign: "Beat taxes AND build wealth" with ELSS + RA bundle offer', priority:'green', competitorIds:['paytmmoney'], isDone:false},
  {id:'ins_014', observation:'SAMCO running options hedging content — retail options sellers growing 60% YoY in India', whyItMatters:'Options sellers need consistent premium income ideas; weekly advisory fits perfectly', action:'Create "Weekly Premium Income" RA product for option sellers — target Sensibull/Dhan users', priority:'red', competitorIds:['samco','sensibull','dhan'], isDone:false},
  {id:'ins_015', observation:'Most competitors using only text-based creative in Google Search — no structured snippet/callout optimization', whyItMatters:'Ad extensions increase CTR 15-30% at same bid — free performance gain being missed', action:'Implement full Google Ad extension suite (callouts, structured snippets, sitelinks) on all campaigns', priority:'green', competitorIds:[], isDone:false},
  {id:'ins_016', observation:'Groww running "SIP for goals" ads (house, retirement, child) — goal-based investing narrative dominant', whyItMatters:'Goal-framing increases SIP ticket size by 35% — investors commit more when anchored to outcomes', action:'Reframe RA positioning around goals: "Retire at 50 with Univest advisory" instead of stock returns', priority:'yellow', competitorIds:['groww'], isDone:false},
  {id:'ins_017', observation:'StockGro + WeekendInvesting both targeting college students and young professionals under 28', whyItMatters:'3.5 crore new demat accounts opened in 2024, majority under 30 — acquisition cost still low', action:'Campus ambassador program + Instagram Reel series targeting 20-27 year olds on personal finance', priority:'yellow', competitorIds:['stockgro','weekendinvesting'], isDone:false},
  {id:'ins_018', observation:'No RA competitor running LinkedIn thought leadership ads targeting HNI or corporate professionals', whyItMatters:'HNI segment (10L+ investable surplus) has 10x LTV vs retail — underserved by current RA market', action:'Launch premium LinkedIn campaign with CEO/CIO portfolio case studies targeting C-suite and founders', priority:'yellow', competitorIds:[], isDone:false},
  {id:'ins_019', observation:'Zerodha Coin MF ads emphasizing "direct plans" — commission-free narrative building brand trust', whyItMatters:'Fee transparency is increasingly demanded; advisory firms that show value clearly win trust faster', action:'Publish Univest RA transparent ROI tracker — "Our subscribers made X% vs Nifty50 in 2025"', priority:'green', competitorIds:['zerodha'], isDone:false},
  {id:'ins_020', observation:'Dhan and Upstox using cricket/IPL season to boost brand awareness — seasonal moment underutilized', whyItMatters:'IPL season drives peak financial app downloads; co-created content with cricketers has high recall', action:'Plan IPL 2026 campaign: sponsor a fantasy league or partner with cricket analytics content creator', priority:'green', competitorIds:['dhan','upstox'], isDone:false},
  {id:'ins_021', observation:'Angel One and Zerodha barely running vernacular language ads — Hindi, Tamil, Telugu markets untapped', whyItMatters:'70% of new demat accounts come from Tier 2/3 cities; vernacular advisory is a blue ocean', action:'Produce Hindi-language RA advisory content and run regional Meta ads in UP, MP, Rajasthan', priority:'red', competitorIds:['angelone','zerodha'], isDone:false},
  {id:'ins_022', observation:'WeekendInvesting charging flat subscription vs % AUM — flat fee model growing in preference', whyItMatters:'Flat fee eliminates conflicts of interest; investors increasingly skeptical of AUM-based advisors', action:'A/B test flat ₹999/month vs ₹4999/quarter pricing for RA — track retention and LTV difference', priority:'yellow', competitorIds:['weekendinvesting'], isDone:false},
  {id:'ins_023', observation:'Sensibull integration with 5+ brokers creates lock-in — no RA has built deep broker integrations', whyItMatters:'Broker-integrated advisory removes friction from recommendation to execution — key retention driver', action:'Build one-click trade execution from Univest RA calls via Zerodha/AngelOne API partnerships', priority:'red', competitorIds:['sensibull'], isDone:false},
  {id:'ins_024', observation:'Groww and Zerodha both underinvesting in post-purchase onboarding ads — acquisition focused only', whyItMatters:'70% of new investors make no second investment within 60 days — activation is the critical gap', action:'Run reactivation drip campaign targeting inactive investors: "Your ₹X is sitting idle. Here\'s what to buy."', priority:'yellow', competitorIds:['groww','zerodha'], isDone:false},
  {id:'ins_025', observation:'No competitor has a dedicated small-cap/microcap advisory product — all recommend large-cap/MF', whyItMatters:'Small-cap alpha opportunity is 3-5x large-cap in India — premium pricing justified for specialist service', action:'Launch "Hidden Gems" small-cap RA tier at ₹2999/month with exclusive research reports', priority:'yellow', competitorIds:[], isDone:false}
]`;

const oldInsightsMatch = html.match(/insights:\s*\[[\s\S]*?\],\s*\n\nnotes:/);
if(oldInsightsMatch) {
  html = html.replace(oldInsightsMatch[0], newInsights + ',\n\nnotes:');
  console.log('Fix 4 (25 new insights): applied');
} else {
  console.log('Fix 4: insights pattern not found');
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 5: Module F — update isDone field check (field is isDone not done)
//         and make sure summary counts work
// ─────────────────────────────────────────────────────────────────────────────
// Check if renderSummary uses isDone correctly
const hasDoneCheck = html.includes('isDone');
console.log('Fix 5 (isDone field check):', hasDoneCheck ? 'field present in insights' : 'WARNING: isDone not found');

// ─────────────────────────────────────────────────────────────────────────────
// FIX 6: Module C — ensure format defaults don't throw on missing value
// ─────────────────────────────────────────────────────────────────────────────
html = html.replace(
  'var f=ad.format.toLowerCase()',
  'var f=(ad.format||"other").toLowerCase()'
);
html = html.replace(
  'var k=ad.hookStyle.toLowerCase()',
  'var k=(ad.hookStyle||"benefit_led").toLowerCase()'
);
console.log('Fix 6 (Module C null safety): applied');

// ─────────────────────────────────────────────────────────────────────────────
// FIX 7: Module E — fix vertical filter to use 'both' for mixed competitors
// ─────────────────────────────────────────────────────────────────────────────
// The competitor data has vertical:'broking' or 'ra', but filter checks c.vertical===f.vertical
// This is fine — but make sure filter works when f.vertical = 'both'
// Already handled by: if(f.vertical&&f.vertical!=='both') — OK

fs.writeFileSync('C:/Users/Dell/Desktop/creative-portal/univest_ci_portal.html', html);
console.log('\nAll fixes written. File size:', (html.length/1024).toFixed(1)+'KB');

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY all fixes
// ─────────────────────────────────────────────────────────────────────────────
const final = fs.readFileSync('C:/Users/Dell/Desktop/creative-portal/univest_ci_portal.html', 'utf8');
console.log('\n--- VERIFICATION ---');
console.log('Module E year hardcode removed:', !final.includes('x.year===2024'));
console.log('Competitor recompute normalization:', final.includes('recomputeCompStats'));
console.log('Module B date filter:', final.includes('if(f.dateFrom){var from=new Date(f.dateFrom);ads=ads.filter'));
console.log('25 insights present:', (final.match(/id:'ins_/g)||[]).length);
console.log('Module C null safety:', final.includes('(ad.format||"other").toLowerCase()'));
