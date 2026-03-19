const fs = require('fs');
let html = fs.readFileSync('C:/Users/Dell/Desktop/creative-portal/univest_ci_portal.html', 'utf8');

// 1. Add adUrl normalization block
const adUrlCode = `
// Generate ad library URLs per platform + competitor
var META_ADVERTISER_IDS = {
  zerodha: '339370099543', groww: '1926251767620923', angelone: '198760073595085',
  upstox: '111558890555136', '5paisa': '478824185626498', dhan: '107069418095538',
  paytmmoney: '1657695184444869', samco: '278017019045484', stockgro: '351567829380488',
  sensibull: '1760523587530073', definedge: '557036714651398', weekendinvesting: '106519748232552'
};
var COMP_SEARCH_NAMES = {
  zerodha:'Zerodha', groww:'Groww', angelone:'Angel One', upstox:'Upstox',
  '5paisa':'5paisa', dhan:'Dhan Broking', paytmmoney:'Paytm Money',
  samco:'SAMCO', stockgro:'StockGro', sensibull:'Sensibull',
  definedge:'Definedge Securities', weekendinvesting:'Weekend Investing'
};
window.UNIVEST_DATA.ads.forEach(function(a) {
  if (a.adUrl) return;
  var name = encodeURIComponent(COMP_SEARCH_NAMES[a.competitorId] || a.competitorId);
  var pid = META_ADVERTISER_IDS[a.competitorId];
  var plat = (Array.isArray(a.platform) ? a.platform[0] : a.platform) || 'meta';
  if (plat === 'meta') {
    a.adUrl = pid
      ? 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IN&view_all_page_id=' + pid
      : 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IN&q=' + name;
  } else if (plat === 'google' || plat === 'youtube') {
    a.adUrl = 'https://adstransparency.google.com/?region=IN&query=' + name;
  } else if (plat === 'linkedin') {
    a.adUrl = 'https://www.linkedin.com/ad-library/search?q=' + name;
  } else {
    a.adUrl = 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IN&q=' + name;
  }
});
`;

html = html.replace('// Normalize campaign fields', adUrlCode + '\n// Normalize campaign fields');

// 2. Add CSS for the link icon
const linkCss = `
<style>
.ad-library-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: rgba(77,171,247,0.1);
  border: 1px solid rgba(77,171,247,0.25);
  color: var(--blue);
  font-size: 12px;
  text-decoration: none;
  flex-shrink: 0;
  transition: var(--transition);
  line-height: 1;
}
.ad-library-link:hover {
  background: rgba(77,171,247,0.2);
  border-color: var(--blue);
  transform: translateY(-1px);
}
</style>
`;
// Inject CSS before Module A section script
html = html.replace('<section id="module-a"', linkCss + '<section id="module-a"');

// 3. Update buildAdCard — add adLink variable and insert into header
// Use exact strings as found in the file (4-space indent, double-escaped quotes)
const oldPlatformPills = `  var platformPills=platforms.map(function(p){return '<span class="platform-pill-ma" style="background:'+(PLATFORM_COLORS[p]||'#555')+'">'+esc(p)+'</span>';}).join('');
  return '<div class="ad-card" data-competitor-id="'+esc(comp.id||ad.competitorId||'')+'">'\n    +'<div class="ad-card-header">'\n    +'<div class="competitor-badge-ma"><span class="competitor-dot-ma" style="background:'+comp.color+'"></span><span>'+esc(comp.name)+'</span></div>'\n    +'<div style="display:flex;align-items:center;gap:6px"><div class="platform-pills">'+platformPills+'</div><span>'+formatIcon+'</span></div>'\n    +'</div>'`;

const newPlatformPills = `  var platformPills=platforms.map(function(p){return '<span class="platform-pill-ma" style="background:'+(PLATFORM_COLORS[p]||'#555')+'">'+esc(p)+'</span>';}).join('');
  var adLink=ad.adUrl?'<a href="'+ad.adUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="View in Ad Library" class="ad-library-link">&#128279;</a>':'';
  return '<div class="ad-card" data-competitor-id="'+esc(comp.id||ad.competitorId||'')+'">'\n    +'<div class="ad-card-header">'\n    +'<div class="competitor-badge-ma"><span class="competitor-dot-ma" style="background:'+comp.color+'"></span><span>'+esc(comp.name)+'</span></div>'\n    +'<div style="display:flex;align-items:center;gap:6px">'+adLink+'<div class="platform-pills">'+platformPills+'</div><span>'+formatIcon+'</span></div>'\n    +'</div>'`;

if (html.includes(oldPlatformPills)) {
  html = html.replace(oldPlatformPills, newPlatformPills);
  console.log('Card template updated successfully');
} else {
  console.log('ERROR: exact match not found');
  // Debug: show what we have around platformPills
  const idx = html.indexOf('var platformPills=platforms.map');
  if (idx >= 0) console.log('Found at:', idx, '\n', JSON.stringify(html.slice(idx, idx+300)));
}

fs.writeFileSync('C:/Users/Dell/Desktop/creative-portal/univest_ci_portal.html', html);
console.log('adUrl normalization:', html.includes('META_ADVERTISER_IDS') ? 'OK' : 'MISSING');
console.log('ad-library-link CSS:', html.includes('ad-library-link') ? 'OK' : 'MISSING');
console.log('adLink in card:', html.includes("var adLink = ad.adUrl") ? 'OK' : 'MISSING');
console.log('File size:', (html.length / 1024).toFixed(1) + 'KB');
