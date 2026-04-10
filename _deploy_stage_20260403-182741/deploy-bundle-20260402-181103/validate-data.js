// Quick data validation: compare portal pipeline output vs spreadsheet ground truth
// Usage: node validate-data.js  (server must be running on localhost:3000)

const fs = require('fs');

const SERVER = 'http://localhost:3000';

// Ground truth from data-check.csv (campaign-level totals)
const SPREADSHEET = {
    'Test-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_131125': {
        spend: 3507584.409,  // raw spend (no GST)
        signups: 2644,
        p0_signup: 263,
        p1_signup: 684,
        d0_trial: 507,
        d0: 29,
        d6_overall_con: 108,  // "Sum of d0-d6" column
        d0_revenue: 88371,
        d6_overall_revenue: 395092.05,
        overall_revenue: 426983.05,
        d6_mandate_amount: 145843,
        total_trial: 630,
        impressions: 24298139,
        clicks: 204099,
        installs: 7814,
    },
    'Test2-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_051225': {
        spend: 2351555.236,
        signups: 1096,
        p0_signup: 158,
        p1_signup: 323,
        d0_trial: 259,
        d0: 23,
        d6_overall_con: 69,
        d0_revenue: 41127,
        d6_overall_revenue: 197005,
        overall_revenue: 204117.95,
        d6_mandate_amount: 66075,
        total_trial: 322,
        impressions: 14196797,
        clicks: 67303,
        installs: 2718,
    },
    'Test4-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_200326': {
        spend: 76033.418,
        signups: 44,
        p0_signup: 2,
        p1_signup: 5,
        d0_trial: 5,
        d0: 0,
        d6_overall_con: 0,
        d0_revenue: 0,
        d6_overall_revenue: 0,
        overall_revenue: 0,
        d6_mandate_amount: 0,
        total_trial: 6,
        impressions: 974272,
        clicks: 32026,
        installs: 144,
    },
};

// Find the date range from the CSV (scan for date rows)
// The CSV has dates like "10-03-2026" format, the earliest data seems to be around Nov 2025
// Use a wide range to capture all data
const DATE_FROM = '2026-02-24';
const DATE_TO = '2026-03-26';

async function fetchJSON(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

async function main() {
    console.log('=== DATA VALIDATION: Portal Pipeline vs Spreadsheet ===\n');
    console.log(`Date range: ${DATE_FROM} to ${DATE_TO}\n`);

    // 1. Fetch from same endpoints the portal uses
    console.log('Fetching Meta API + Metabase...');
    let metaRes, funnelRes;
    try {
        [metaRes, funnelRes] = await Promise.all([
            fetchJSON(`${SERVER}/api/meta/ad-insights-daily`, { dateFrom: DATE_FROM, dateTo: DATE_TO }),
            fetchJSON(`${SERVER}/api/metabase/ad-funnel`, { dateFrom: DATE_FROM, dateTo: DATE_TO }),
        ]);
    } catch (e) {
        console.error('ERROR: Could not connect to server. Is it running on localhost:3000?\n', e.message);
        process.exit(1);
    }

    if (!metaRes.success) { console.error('Meta API failed:', metaRes.error); process.exit(1); }
    if (!funnelRes.success) { console.error('Metabase failed:', funnelRes.error); process.exit(1); }

    const metaRows = metaRes.data.filter(r => /android/i.test(r.campaign_name));
    const funnelRows = funnelRes.data || [];
    console.log(`Meta: ${metaRows.length} rows | Metabase: ${funnelRows.length} rows\n`);

    // 2. Run the same pipeline as app.js — aggregate by campaign

    // META side: sum per campaign
    const metaByCampaign = {};
    for (const row of metaRows) {
        const c = row.campaign_name;
        if (!metaByCampaign[c]) metaByCampaign[c] = { spend: 0, impressions: 0, clicks: 0, installs: 0 };
        metaByCampaign[c].spend += row.spend || 0;
        metaByCampaign[c].impressions += row.impressions || 0;
        metaByCampaign[c].clicks += row.clicks || 0;
        metaByCampaign[c].installs += row.installs || 0;
    }

    // METABASE side: aggregate by meta_campaign_id, then map to campaign name
    const mbByCampaignId = {};
    for (const row of funnelRows) {
        const id = row.meta_campaign_id || '';
        if (!id) continue;
        if (!mbByCampaignId[id]) mbByCampaignId[id] = {
            campaign_name: row.campaign_name,
            signups: 0, p0_signup: 0, p1_signup: 0, d0_trial: 0, d0: 0,
            d6_overall_con: 0, d0_revenue: 0, d6_overall_revenue: 0,
            overall_revenue: 0, total_trial: 0,
        };
        const m = mbByCampaignId[id];
        m.signups += Number(row.signups) || 0;
        m.p0_signup += Number(row.p0_signup) || 0;
        m.p1_signup += Number(row.p1_signup) || 0;
        m.d0_trial += Number(row.d0_trial) || 0;
        m.d0 += Number(row.d0) || 0;
        m.d6_overall_con += Number(row.d6_overall_con) || 0;
        m.d0_revenue += Number(row.d0_revenue) || 0;
        m.d6_overall_revenue += Number(row.d6_overall_revenue) || 0;
        m.overall_revenue += Number(row.overall_revenue) || 0;
        m.total_trial += Number(row.total_trial) || 0;
    }

    // Map meta_campaign_id → campaign_name for joining
    // Also try to find campaign_id from Meta data
    const campaignIdToName = {};
    for (const row of metaRows) {
        if (row.campaign_id && row.campaign_name) {
            campaignIdToName[row.campaign_id] = row.campaign_name;
        }
    }

    // 3. Compare each campaign
    console.log('─'.repeat(100));
    console.log('CAMPAIGN-LEVEL COMPARISON');
    console.log('─'.repeat(100));

    let totalFields = 0, matchedFields = 0, closeFields = 0;

    for (const [campName, sheet] of Object.entries(SPREADSHEET)) {
        console.log(`\n📊 ${campName}`);

        // Meta side
        const meta = metaByCampaign[campName];
        if (!meta) {
            console.log('  ❌ NOT FOUND in Meta API response');
            continue;
        }

        // Find this campaign's meta_campaign_id
        let campId = null;
        for (const row of metaRows) {
            if (row.campaign_name === campName && row.campaign_id) { campId = row.campaign_id; break; }
        }
        console.log(`  Meta campaign_id: ${campId || 'NOT FOUND'}`);

        // Metabase side — lookup by campaign ID
        const mb = campId ? mbByCampaignId[campId] : null;
        if (!mb) {
            console.log('  ❌ NOT FOUND in Metabase by campaign ID');
            // Try by campaign name
            const byName = Object.values(mbByCampaignId).find(m => m.campaign_name === campName);
            if (byName) console.log('  ⚠️  Found by campaign NAME (old method) — ID match failed');
        }

        // Compare Meta metrics (spend, impressions, clicks, installs)
        const metaFields = ['spend', 'impressions', 'clicks', 'installs'];
        console.log('\n  META API metrics:');
        for (const f of metaFields) {
            const portal = meta[f] || 0;
            const expected = sheet[f] || 0;
            const pct = expected > 0 ? ((portal - expected) / expected * 100).toFixed(1) : (portal === 0 ? '0.0' : 'N/A');
            const match = Math.abs(parseFloat(pct)) < 2 ? '✅' : Math.abs(parseFloat(pct)) < 10 ? '⚠️' : '❌';
            console.log(`    ${match} ${f.padEnd(15)} Portal: ${Math.round(portal).toLocaleString().padStart(12)}  Sheet: ${Math.round(expected).toLocaleString().padStart(12)}  Diff: ${pct}%`);
            totalFields++;
            if (Math.abs(parseFloat(pct)) < 2) matchedFields++;
            else if (Math.abs(parseFloat(pct)) < 10) closeFields++;
        }

        // Compare Metabase metrics (funnel data)
        if (mb) {
            const mbFields = ['signups', 'p0_signup', 'p1_signup', 'd0_trial', 'd0', 'd6_overall_con', 'd0_revenue', 'd6_overall_revenue', 'overall_revenue', 'total_trial'];
            console.log('\n  METABASE funnel metrics (via campaign ID join):');
            for (const f of mbFields) {
                const portal = mb[f] || 0;
                const expected = sheet[f] || 0;
                const pct = expected > 0 ? ((portal - expected) / expected * 100).toFixed(1) : (portal === 0 ? '0.0' : 'N/A');
                const match = Math.abs(parseFloat(pct)) < 2 ? '✅' : Math.abs(parseFloat(pct)) < 10 ? '⚠️' : '❌';
                console.log(`    ${match} ${f.padEnd(22)} Portal: ${Math.round(portal).toLocaleString().padStart(12)}  Sheet: ${Math.round(expected).toLocaleString().padStart(12)}  Diff: ${pct}%`);
                totalFields++;
                if (Math.abs(parseFloat(pct)) < 2) matchedFields++;
                else if (Math.abs(parseFloat(pct)) < 10) closeFields++;
            }
        }
    }

    // 4. Also check: how many Metabase campaign IDs matched Meta campaign IDs?
    console.log('\n' + '─'.repeat(100));
    console.log('JOIN DIAGNOSTICS');
    console.log('─'.repeat(100));

    const metaCampaignIds = new Set(Object.keys(campaignIdToName));
    const mbCampaignIds = new Set(Object.keys(mbByCampaignId));
    const matched = [...mbCampaignIds].filter(id => metaCampaignIds.has(id));
    const unmatched = [...mbCampaignIds].filter(id => !metaCampaignIds.has(id));

    console.log(`\nMeta campaign IDs: ${metaCampaignIds.size}`);
    console.log(`Metabase campaign IDs (via SPLIT_PART): ${mbCampaignIds.size}`);
    console.log(`Matched: ${matched.length} / ${mbCampaignIds.size} (${(matched.length / mbCampaignIds.size * 100).toFixed(1)}%)`);
    if (unmatched.length > 0 && unmatched.length <= 20) {
        console.log(`Unmatched Metabase IDs: ${unmatched.join(', ')}`);
    }

    // Show sample tracker_name → meta_campaign_id extraction
    console.log('\nSample Metabase rows (first 5):');
    for (const row of funnelRows.slice(0, 5)) {
        console.log(`  tracker_name field in response: campaign_name="${row.campaign_name}" meta_campaign_id="${row.meta_campaign_id}" adset="${row.ad_set_name}"`);
    }

    // 5. Summary
    console.log('\n' + '═'.repeat(100));
    console.log('SUMMARY');
    console.log('═'.repeat(100));
    const exactPct = totalFields > 0 ? (matchedFields / totalFields * 100).toFixed(1) : 0;
    const closePct = totalFields > 0 ? ((matchedFields + closeFields) / totalFields * 100).toFixed(1) : 0;
    console.log(`Total fields compared: ${totalFields}`);
    console.log(`✅ Exact match (<2% diff): ${matchedFields} (${exactPct}%)`);
    console.log(`⚠️  Close match (<10% diff): ${closeFields}`);
    console.log(`❌ Mismatch (>10% diff): ${totalFields - matchedFields - closeFields}`);
    console.log(`Overall accuracy: ${closePct}%`);
    console.log('═'.repeat(100));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
