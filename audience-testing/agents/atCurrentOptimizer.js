/**
 * AT Current Optimizer Agent
 * Monitors live Meta adsets and Google adgroups for health issues,
 * flags anomalies, and identifies scale opportunities.
 */

module.exports = function(config) {
    const { getAtDb } = require('../db/at-db');

    const META_ACCESS_TOKEN = config.metaAccessToken || process.env.META_ACCESS_TOKEN || '';
    const META_AD_ACCOUNT_ID = config.metaAdAccountId || process.env.META_AD_ACCOUNT_ID || 'act_725019929189148';
    const META_API_VERSION = 'v21.0';
    const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

    function log(...args) {
        console.log('[AT Optimizer]', ...args);
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    async function metaGet(url, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${META_ACCESS_TOKEN}` }
            });
            if (res.status === 429) {
                log(`Rate limited (429). Waiting 60s before retry ${attempt}/${retries}...`);
                await sleep(60000);
                continue;
            }
            if (!res.ok) {
                const body = await res.text();
                throw new Error(`Meta API ${res.status}: ${body}`);
            }
            return res.json();
        }
        throw new Error('Meta API rate limit exceeded after max retries');
    }

    // --------------- fetchLiveMetaAdsets ---------------

    async function fetchLiveMetaAdsets() {
        log('Fetching live ACTIVE Meta adsets...');
        const fields = 'id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal';
        const filtering = encodeURIComponent(JSON.stringify([{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]));
        const url = `${META_API_BASE}/${META_AD_ACCOUNT_ID}/adsets?fields=${fields}&filtering=${filtering}&limit=500&access_token=${META_ACCESS_TOKEN}`;

        const allAdsets = [];
        let nextUrl = url;

        while (nextUrl) {
            const data = await metaGet(nextUrl);
            const adsets = data.data || [];
            allAdsets.push(...adsets);

            nextUrl = null;
            if (data.paging && data.paging.next) {
                nextUrl = data.paging.next;
            }
        }

        log(`Fetched ${allAdsets.length} live Meta adsets`);
        return allAdsets;
    }

    // --------------- fetchLiveGoogleAdgroups ---------------

    async function fetchLiveGoogleAdgroups() {
        log('Fetching live ENABLED Google adgroups from local DB (last 7 days)...');
        const db = getAtDb();

        // Pull enabled adgroups with recent spend from our synced data
        const rows = db.prepare(`
            SELECT ag.google_adgroup_id, ag.name, ag.status, ag.google_campaign_id,
                   ag.total_spend, ag.impressions, ag.clicks, ag.conversions,
                   ag.cost_per_conversion, ag.d6_cac, ag.d6_roas, ag.d6_conversions,
                   gc.name AS campaign_name
            FROM at_google_adgroups ag
            LEFT JOIN at_google_campaigns gc ON gc.google_campaign_id = ag.google_campaign_id
            WHERE ag.status = 'ENABLED'
        `).all();

        log(`Found ${rows.length} enabled Google adgroups`);
        return rows;
    }

    // --------------- checkHealth ---------------

    async function checkHealth() {
        log('=== Starting health check ===');
        const db = getAtDb();
        const flags = [];

        // Fetch live data
        let liveMetaAdsets = [];
        let liveGoogleAdgroups = [];

        try {
            liveMetaAdsets = await fetchLiveMetaAdsets();
        } catch (err) {
            log('Error fetching live Meta adsets:', err.message);
        }

        try {
            liveGoogleAdgroups = await fetchLiveGoogleAdgroups();
        } catch (err) {
            log('Error fetching live Google adgroups:', err.message);
        }

        // --- Check Meta adsets ---
        for (const adset of liveMetaAdsets) {
            const adsetId = adset.id;
            const adsetName = adset.name || '';

            // Look up historical data
            const historical = db.prepare(
                'SELECT * FROM at_meta_adsets WHERE meta_adset_id = ?'
            ).get(adsetId);

            if (!historical) continue;

            const spend7d = historical.total_spend || 0;
            const conversions = historical.d6_conversions || 0;
            const frequency = historical.frequency || 0;
            const currentCac = historical.d6_cac || 0;
            const dailyBudget = parseFloat(adset.daily_budget || 0) / 100;
            const budgetUtilization = dailyBudget > 0 ? (spend7d / (dailyBudget * 7)) * 100 : 100;

            // Get historical average CAC for comparison
            const avgCacRow = db.prepare(`
                SELECT AVG(d6_cac) AS avg_cac FROM at_meta_adsets
                WHERE d6_cac IS NOT NULL AND d6_cac > 0 AND meta_campaign_id = ?
            `).get(historical.meta_campaign_id);
            const historicalCac = (avgCacRow && avgCacRow.avg_cac) || currentCac;

            // HIGH_SPEND_NO_CONV: spend_7d > 10000 AND conversions < 2
            if (spend7d > 10000 && conversions < 2) {
                flags.push({
                    platform: 'meta',
                    adset_id: adsetId,
                    adset_name: adsetName,
                    flag_type: 'HIGH_SPEND_NO_CONV',
                    severity: 'CRITICAL',
                    message: `Spent ₹${spend7d.toFixed(0)} with only ${conversions} conversions`,
                    metric_value: spend7d,
                    threshold_value: 10000
                });
            }

            // CAC_DETERIORATION: current_cac > historical_cac * 1.5
            if (currentCac > 0 && historicalCac > 0 && currentCac > historicalCac * 1.5) {
                flags.push({
                    platform: 'meta',
                    adset_id: adsetId,
                    adset_name: adsetName,
                    flag_type: 'CAC_DETERIORATION',
                    severity: 'WARNING',
                    message: `CAC ₹${currentCac.toFixed(0)} is ${((currentCac / historicalCac) * 100 - 100).toFixed(0)}% above historical ₹${historicalCac.toFixed(0)}`,
                    metric_value: currentCac,
                    threshold_value: historicalCac * 1.5
                });
            }

            // AUDIENCE_FATIGUE: frequency > 3.5
            if (frequency > 3.5) {
                flags.push({
                    platform: 'meta',
                    adset_id: adsetId,
                    adset_name: adsetName,
                    flag_type: 'AUDIENCE_FATIGUE',
                    severity: 'WARNING',
                    message: `Frequency ${frequency.toFixed(2)} exceeds fatigue threshold of 3.5`,
                    metric_value: frequency,
                    threshold_value: 3.5
                });
            }

            // DELIVERY_ISSUE: budget_utilization < 50%
            if (dailyBudget > 0 && budgetUtilization < 50) {
                flags.push({
                    platform: 'meta',
                    adset_id: adsetId,
                    adset_name: adsetName,
                    flag_type: 'DELIVERY_ISSUE',
                    severity: 'INFO',
                    message: `Budget utilization only ${budgetUtilization.toFixed(0)}% (₹${spend7d.toFixed(0)} of ₹${(dailyBudget * 7).toFixed(0)} weekly budget)`,
                    metric_value: budgetUtilization,
                    threshold_value: 50
                });
            }

            // SCALE_SIGNAL: current_cac < historical_cac * 0.7 AND conversions > 5
            if (currentCac > 0 && historicalCac > 0 && currentCac < historicalCac * 0.7 && conversions > 5) {
                flags.push({
                    platform: 'meta',
                    adset_id: adsetId,
                    adset_name: adsetName,
                    flag_type: 'SCALE_SIGNAL',
                    severity: 'OPPORTUNITY',
                    message: `CAC ₹${currentCac.toFixed(0)} is ${((1 - currentCac / historicalCac) * 100).toFixed(0)}% below historical with ${conversions} conversions — scale candidate`,
                    metric_value: currentCac,
                    threshold_value: historicalCac * 0.7
                });
            }
        }

        // --- Check Google adgroups ---
        for (const ag of liveGoogleAdgroups) {
            const agId = ag.google_adgroup_id;
            const agName = ag.name || '';
            const spend7d = ag.total_spend || 0;
            const conversions = ag.conversions || 0;
            const currentCac = ag.d6_cac || ag.cost_per_conversion || 0;

            // Get historical average CAC for the campaign
            const avgCacRow = db.prepare(`
                SELECT AVG(d6_cac) AS avg_cac FROM at_google_adgroups
                WHERE d6_cac IS NOT NULL AND d6_cac > 0 AND google_campaign_id = ?
            `).get(ag.google_campaign_id);
            const historicalCac = (avgCacRow && avgCacRow.avg_cac) || currentCac;

            // HIGH_SPEND_NO_CONV
            if (spend7d > 10000 && conversions < 2) {
                flags.push({
                    platform: 'google',
                    adset_id: agId,
                    adset_name: agName,
                    flag_type: 'HIGH_SPEND_NO_CONV',
                    severity: 'CRITICAL',
                    message: `Spent ₹${spend7d.toFixed(0)} with only ${conversions} conversions`,
                    metric_value: spend7d,
                    threshold_value: 10000
                });
            }

            // CAC_DETERIORATION
            if (currentCac > 0 && historicalCac > 0 && currentCac > historicalCac * 1.5) {
                flags.push({
                    platform: 'google',
                    adset_id: agId,
                    adset_name: agName,
                    flag_type: 'CAC_DETERIORATION',
                    severity: 'WARNING',
                    message: `CAC ₹${currentCac.toFixed(0)} is ${((currentCac / historicalCac) * 100 - 100).toFixed(0)}% above historical ₹${historicalCac.toFixed(0)}`,
                    metric_value: currentCac,
                    threshold_value: historicalCac * 1.5
                });
            }

            // DELIVERY_ISSUE (check via impressions — low impressions relative to spend suggests delivery issues)
            const impressions = ag.impressions || 0;
            if (spend7d > 0 && impressions < 100) {
                flags.push({
                    platform: 'google',
                    adset_id: agId,
                    adset_name: agName,
                    flag_type: 'DELIVERY_ISSUE',
                    severity: 'INFO',
                    message: `Only ${impressions} impressions despite ₹${spend7d.toFixed(0)} spend — possible delivery issue`,
                    metric_value: impressions,
                    threshold_value: 100
                });
            }

            // SCALE_SIGNAL
            if (currentCac > 0 && historicalCac > 0 && currentCac < historicalCac * 0.7 && conversions > 5) {
                flags.push({
                    platform: 'google',
                    adset_id: agId,
                    adset_name: agName,
                    flag_type: 'SCALE_SIGNAL',
                    severity: 'OPPORTUNITY',
                    message: `CAC ₹${currentCac.toFixed(0)} is ${((1 - currentCac / historicalCac) * 100).toFixed(0)}% below historical with ${conversions} conversions — scale candidate`,
                    metric_value: currentCac,
                    threshold_value: historicalCac * 0.7
                });
            }
        }

        // --- Clear old unresolved flags older than 7 days ---
        db.prepare(`
            UPDATE at_live_flags SET is_resolved = 1, resolved_at = datetime('now')
            WHERE is_resolved = 0 AND detected_at < datetime('now', '-7 days')
        `).run();

        // --- Mark all existing unresolved flags as resolved before inserting fresh ones ---
        db.prepare(`
            UPDATE at_live_flags SET is_resolved = 1, resolved_at = datetime('now')
            WHERE is_resolved = 0
        `).run();

        // --- Insert new flags ---
        const insertFlag = db.prepare(`
            INSERT INTO at_live_flags (platform, adset_id, adset_name, flag_type, severity, message, metric_value, threshold_value)
            VALUES (@platform, @adset_id, @adset_name, @flag_type, @severity, @message, @metric_value, @threshold_value)
        `);

        const insertAll = db.transaction((items) => {
            for (const item of items) {
                insertFlag.run(item);
            }
        });

        if (flags.length > 0) {
            insertAll(flags);
        }

        log(`Health check complete: ${flags.length} flags generated`);
        return flags;
    }

    // --------------- getFlags ---------------

    function getFlags(filters) {
        const db = getAtDb();
        const conditions = ['1=1'];
        const params = [];

        if (filters && filters.severity) {
            conditions.push('severity = ?');
            params.push(filters.severity.toUpperCase());
        }

        if (filters && filters.platform) {
            conditions.push('platform = ?');
            params.push(filters.platform.toLowerCase());
        }

        if (filters && filters.is_resolved !== undefined && filters.is_resolved !== '') {
            conditions.push('is_resolved = ?');
            params.push(parseInt(filters.is_resolved) || 0);
        } else {
            // Default: show unresolved
            conditions.push('is_resolved = 0');
        }

        if (filters && filters.flag_type) {
            conditions.push('flag_type = ?');
            params.push(filters.flag_type);
        }

        const sql = `SELECT * FROM at_live_flags WHERE ${conditions.join(' AND ')} ORDER BY
            CASE severity
                WHEN 'CRITICAL' THEN 1
                WHEN 'WARNING' THEN 2
                WHEN 'OPPORTUNITY' THEN 3
                WHEN 'INFO' THEN 4
                ELSE 5
            END, detected_at DESC`;

        return db.prepare(sql).all(...params);
    }

    // --------------- refreshFlags ---------------

    async function refreshFlags() {
        const flags = await checkHealth();

        const critical = flags.filter(f => f.severity === 'CRITICAL').length;
        const warning = flags.filter(f => f.severity === 'WARNING').length;
        const opportunity = flags.filter(f => f.severity === 'OPPORTUNITY').length;
        const info = flags.filter(f => f.severity === 'INFO').length;

        return {
            flags,
            summary: {
                total: flags.length,
                critical,
                warning,
                opportunity,
                info
            }
        };
    }

    return { checkHealth, getFlags, refreshFlags };
};
