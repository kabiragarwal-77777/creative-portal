const { insert, query, run } = require('../db/fe-db');

const PREFIX = '[FE:DataQuality]';
const DEFAULT_LOOKBACK_DAYS = Number(process.env.FE_DATA_QUALITY_LOOKBACK_DAYS || 30);

module.exports = function feDataQualityMonitor(config = {}) {
    const defaultPort = process.env.PORT || 3000;
    const appBaseUrl = String(config.appBaseUrl || process.env.APP_BASE_URL || `http://127.0.0.1:${defaultPort}`).replace(/\/$/, '');

    function toIsoDate(date) {
        return new Date(date).toISOString().slice(0, 10);
    }

    function daysAgo(days) {
        return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }

    function toNumber(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function lowerTrim(value) {
        return String(value || '').toLowerCase().trim();
    }

    function trimTrackerName(value) {
        return String(value || '').replace(/:.*$/, '');
    }

    function parseNameDateSuffix(value) {
        const match = String(value || '').match(/(\d{6})$/);
        if (!match) return null;
        const dd = match[1].slice(0, 2);
        const mm = match[1].slice(2, 4);
        const yy = match[1].slice(4, 6);
        return `20${yy}-${mm}-${dd}`;
    }

    function getDaysLive(dateValue) {
        if (!dateValue) return 0;
        const timestamp = new Date(dateValue).getTime();
        if (!Number.isFinite(timestamp)) return 0;
        return Math.max(0, Math.round((Date.now() - timestamp) / 86400000));
    }

    function emptyRaw() {
        return {
            spend: 0, impressions: 0, clicks: 0, installs: 0,
            thruplay: 0, p25: 0, p100: 0,
            signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
            d6: 0, d6_revenue: 0, overall_revenue: 0,
            d6_overall_con: 0, d6_overall_revenue: 0,
            d15_overall_con: 0, d15_overall_revenue: 0,
            d30_overall_con: 0, d30_overall_revenue: 0,
            d60_overall_con: 0, d60_overall_revenue: 0,
            p0_signup: 0, p1_signup: 0, total_trial: 0,
            new_converted_user: 0, new_user_rev: 0,
        };
    }

    function validRoas(spend, revenue) {
        if (!spend || spend <= 0 || revenue == null || revenue < 0) return null;
        if (revenue / spend > 50) return null;
        return (revenue / spend) * 100;
    }

    function deriveMetrics(raw) {
        const p0p1 = (raw.p0_signup || 0) + (raw.p1_signup || 0);
        const d6Revenue = raw.d6_overall_revenue || raw.d6_revenue || 0;
        const d6Conversions = raw.d6_overall_con || raw.d6 || 0;
        return {
            ...raw,
            cpm: raw.impressions > 0 ? (raw.spend / raw.impressions) * 1000 : null,
            ctr: raw.impressions > 0 ? (raw.clicks / raw.impressions) * 100 : null,
            cpi: raw.installs > 0 ? raw.spend / raw.installs : null,
            signupCost: raw.signups > 0 ? raw.spend / raw.signups : null,
            d6Con: d6Conversions,
            d6ROAS: validRoas(raw.spend, d6Revenue) ?? 0,
            overallROAS: validRoas(raw.spend, raw.overall_revenue) ?? 0,
            p0p1,
        };
    }

    function round1(value) {
        return Math.round(toNumber(value) * 10) / 10;
    }

    function getEvaluatedD6ROAS(record) {
        if (!record) return 0;
        if (record.isMatured && record.evaluatedD6ROAS != null) {
            return toNumber(record.evaluatedD6ROAS);
        }
        return toNumber(record.d6ROAS);
    }

    function getD6RankingMode(record) {
        if (!record) return 'Full Data';
        if (record.isMatured && record.evaluatedD6ROAS != null) return 'Mature Eval';
        if (record.isMatured) return 'Mature Full';
        return 'Early Data';
    }

    function buildTopRoasRanking(records, { minSpend = 0 } = {}) {
        const candidates = [...records].filter(record => getEvaluatedD6ROAS(record) > 0 && toNumber(record.spend) > minSpend);
        const matured = candidates
            .filter(record => record.isMatured)
            .sort((a, b) => getEvaluatedD6ROAS(b) - getEvaluatedD6ROAS(a));
        const early = candidates
            .filter(record => !record.isMatured)
            .sort((a, b) => getEvaluatedD6ROAS(b) - getEvaluatedD6ROAS(a));

        return [...matured, ...early].slice(0, 5).map(record => ({
            ...record,
            _rankD6ROAS: getEvaluatedD6ROAS(record),
            _d6DataMode: getD6RankingMode(record),
        }));
    }

    function makeFinding({
        source,
        checkName,
        status = 'OK',
        severity = 'info',
        title,
        message,
        detectedValue = null,
        expectedValue = null,
        meta = null,
    }) {
        return {
            source,
            check_name: checkName,
            status,
            severity,
            title,
            message,
            detected_value: detectedValue,
            expected_value: expectedValue,
            meta_json: meta ? JSON.stringify(meta) : null,
        };
    }

    function summarizeStatuses(findings) {
        if (findings.some(f => f.status === 'FAIL')) return 'FAIL';
        if (findings.some(f => f.status === 'WARN')) return 'WARN';
        return 'OK';
    }

    async function requestJson(endpoint, { method = 'GET', body, timeoutMs = 600000 } = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(appBaseUrl + endpoint, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            const text = await response.text();
            let json = null;
            try {
                json = text ? JSON.parse(text) : null;
            } catch (err) {
                throw new Error(`${endpoint} returned non-JSON: ${text.slice(0, 120)}`);
            }
            if (!response.ok) throw new Error((json && json.error) || `HTTP ${response.status}`);
            if (json && json.success === false) throw new Error(json.error || `Request failed for ${endpoint}`);
            return json;
        } finally {
            clearTimeout(timeout);
        }
    }

    function buildMetaRecords(metaRows, funnelRows, statusRows) {
        const statusMap = {};
        (statusRows || []).forEach(row => {
            statusMap[row.ad_id] = row;
        });

        const mbDaily = {};
        for (const row of funnelRows || []) {
            const key = [
                String(row.date || '').slice(0, 10),
                row.meta_campaign_id || '',
                lowerTrim(row.ad_set_name),
                trimTrackerName(row.tracker_name),
            ].join('|||');
            if (!mbDaily[key]) mbDaily[key] = emptyRaw();
            const bucket = mbDaily[key];
            bucket.signups += toNumber(row.signups);
            bucket.d0_trial += toNumber(row.d0_trial);
            bucket.d0 += toNumber(row.d0);
            bucket.d0_revenue += toNumber(row.d0_revenue);
            bucket.d6 += toNumber(row.d6);
            bucket.d6_revenue += toNumber(row.d6_revenue);
            bucket.overall_revenue += toNumber(row.overall_revenue);
            bucket.p0_signup += toNumber(row.p0_signup);
            bucket.p1_signup += toNumber(row.p1_signup);
            bucket.total_trial += toNumber(row.total_trial);
            bucket.d6_overall_con += toNumber(row.d6_overall_con);
            bucket.d6_overall_revenue += toNumber(row.d6_overall_revenue);
            bucket.d15_overall_con += toNumber(row.d15_overall_con);
            bucket.d15_overall_revenue += toNumber(row.d15_overall_revenue);
            bucket.d30_overall_con += toNumber(row.d30_overall_con);
            bucket.d30_overall_revenue += toNumber(row.d30_overall_revenue);
            bucket.d60_overall_con += toNumber(row.d60_overall_con);
            bucket.d60_overall_revenue += toNumber(row.d60_overall_revenue);
        }

        const adAgg = {};
        for (const row of metaRows || []) {
            const key = [row.campaign_name || '', row.adset_name || '', row.ad_name || ''].join('|||');
            if (!adAgg[key]) {
                adAgg[key] = {
                    ...emptyRaw(),
                    ad_name: row.ad_name || '',
                    ad_id: row.ad_id || '',
                    campaign_name: row.campaign_name || '',
                    campaign_id: row.campaign_id || '',
                    adset_name: row.adset_name || '',
                    dates: [],
                    matched_days: 0,
                };
            }

            const bucket = adAgg[key];
            bucket.spend += toNumber(row.spend) * 1.18;
            bucket.impressions += toNumber(row.impressions);
            bucket.clicks += toNumber(row.clicks);
            bucket.installs += toNumber(row.installs);
            bucket.thruplay += toNumber(row.thruplay);
            bucket.p25 += toNumber(row.p25);
            bucket.p100 += toNumber(row.p100);
            if (toNumber(row.spend) > 0 && row.date_start) bucket.dates.push(row.date_start);

            const funnelKey = [
                row.date_start || '',
                row.campaign_id || '',
                lowerTrim(row.adset_name),
                trimTrackerName(row.ad_name),
            ].join('|||');
            const funnelMetrics = mbDaily[funnelKey];
            if (!funnelMetrics) continue;

            bucket.matched_days += 1;
            bucket.signups += funnelMetrics.signups;
            bucket.d0_trial += funnelMetrics.d0_trial;
            bucket.d0 += funnelMetrics.d0;
            bucket.d0_revenue += funnelMetrics.d0_revenue;
            bucket.d6 += funnelMetrics.d6;
            bucket.d6_revenue += funnelMetrics.d6_revenue;
            bucket.overall_revenue += funnelMetrics.overall_revenue;
            bucket.p0_signup += funnelMetrics.p0_signup;
            bucket.p1_signup += funnelMetrics.p1_signup;
            bucket.total_trial += funnelMetrics.total_trial;
            bucket.d6_overall_con += funnelMetrics.d6_overall_con;
            bucket.d6_overall_revenue += funnelMetrics.d6_overall_revenue;
            bucket.d15_overall_con += funnelMetrics.d15_overall_con;
            bucket.d15_overall_revenue += funnelMetrics.d15_overall_revenue;
            bucket.d30_overall_con += funnelMetrics.d30_overall_con;
            bucket.d30_overall_revenue += funnelMetrics.d30_overall_revenue;
            bucket.d60_overall_con += funnelMetrics.d60_overall_con;
            bucket.d60_overall_revenue += funnelMetrics.d60_overall_revenue;
        }

        return Object.values(adAgg)
            .filter(row => row.ad_name && row.ad_name.includes('FB_'))
            .map(row => {
                const status = statusMap[row.ad_id] || {};
                const firstSpendDate = row.dates.filter(Boolean).sort()[0] || null;
                const goLiveDate = parseNameDateSuffix(row.ad_name) || (status.created_time ? String(status.created_time).slice(0, 10) : null) || firstSpendDate;
                const daysLive = getDaysLive(goLiveDate);
                const derived = deriveMetrics(row);
                return {
                    name: row.ad_name,
                    spend: row.spend,
                    cpi: derived.cpi,
                    d6ROAS: derived.d6ROAS,
                    d6Con: derived.d6Con,
                    signups: row.signups,
                    matched_days: row.matched_days,
                    daysLive,
                    isMatured: daysLive >= 14,
                };
            });
    }

    function buildGoogleRecords(googleRows, funnelRows) {
        const mbDaily = {};
        for (const row of funnelRows || []) {
            const key = [
                String(row.date || '').slice(0, 10),
                row.campaign_name || '',
                lowerTrim(row.ad_set_name),
            ].join('|||');
            if (!mbDaily[key]) mbDaily[key] = emptyRaw();
            const bucket = mbDaily[key];
            bucket.signups += toNumber(row.signups);
            bucket.d0_trial += toNumber(row.d0_trial);
            bucket.d0 += toNumber(row.d0);
            bucket.d0_revenue += toNumber(row.d0_revenue);
            bucket.d6 += toNumber(row.d6);
            bucket.d6_revenue += toNumber(row.d6_revenue);
            bucket.overall_revenue += toNumber(row.overall_revenue);
            bucket.p0_signup += toNumber(row.p0_signup);
            bucket.p1_signup += toNumber(row.p1_signup);
            bucket.total_trial += toNumber(row.total_trial);
            bucket.d6_overall_con += toNumber(row.d6_overall_con);
            bucket.d6_overall_revenue += toNumber(row.d6_overall_revenue);
            bucket.d15_overall_con += toNumber(row.d15_overall_con);
            bucket.d15_overall_revenue += toNumber(row.d15_overall_revenue);
            bucket.d30_overall_con += toNumber(row.d30_overall_con);
            bucket.d30_overall_revenue += toNumber(row.d30_overall_revenue);
            bucket.d60_overall_con += toNumber(row.d60_overall_con);
            bucket.d60_overall_revenue += toNumber(row.d60_overall_revenue);
        }

        const adsetAgg = {};
        for (const row of googleRows || []) {
            const adsetName = row.adset_name || row.adgroup_name || '';
            const key = [row.campaign_name || '', adsetName].join('|||');
            if (!adsetAgg[key]) {
                adsetAgg[key] = {
                    ...emptyRaw(),
                    campaign_name: row.campaign_name || '',
                    adset_name: adsetName,
                    dates: [],
                    matched_days: 0,
                };
            }

            const bucket = adsetAgg[key];
            bucket.spend += (toNumber(row.spend) || toNumber(row.cost_micros) / 1000000) * 1.18;
            bucket.impressions += toNumber(row.impressions);
            bucket.clicks += toNumber(row.clicks);
            bucket.installs += toNumber(row.conversions);
            const rowDate = row.date_start || row.date || row.segments_date || '';
            if ((toNumber(row.spend) || toNumber(row.cost_micros)) > 0 && rowDate) bucket.dates.push(rowDate);

            const funnelKey = [rowDate, row.campaign_name || '', lowerTrim(adsetName)].join('|||');
            const funnelMetrics = mbDaily[funnelKey];
            if (!funnelMetrics) continue;

            bucket.matched_days += 1;
            bucket.signups += funnelMetrics.signups;
            bucket.d0_trial += funnelMetrics.d0_trial;
            bucket.d0 += funnelMetrics.d0;
            bucket.d0_revenue += funnelMetrics.d0_revenue;
            bucket.d6 += funnelMetrics.d6;
            bucket.d6_revenue += funnelMetrics.d6_revenue;
            bucket.overall_revenue += funnelMetrics.overall_revenue;
            bucket.p0_signup += funnelMetrics.p0_signup;
            bucket.p1_signup += funnelMetrics.p1_signup;
            bucket.total_trial += funnelMetrics.total_trial;
            bucket.d6_overall_con += funnelMetrics.d6_overall_con;
            bucket.d6_overall_revenue += funnelMetrics.d6_overall_revenue;
            bucket.d15_overall_con += funnelMetrics.d15_overall_con;
            bucket.d15_overall_revenue += funnelMetrics.d15_overall_revenue;
            bucket.d30_overall_con += funnelMetrics.d30_overall_con;
            bucket.d30_overall_revenue += funnelMetrics.d30_overall_revenue;
            bucket.d60_overall_con += funnelMetrics.d60_overall_con;
            bucket.d60_overall_revenue += funnelMetrics.d60_overall_revenue;
        }

        return Object.values(adsetAgg).map(row => {
            const firstSpendDate = row.dates.filter(Boolean).sort()[0] || null;
            const goLiveDate = parseNameDateSuffix(row.campaign_name) || firstSpendDate;
            const daysLive = getDaysLive(goLiveDate);
            const derived = deriveMetrics(row);
            return {
                name: row.adset_name,
                spend: row.spend,
                cpi: derived.cpi,
                d6ROAS: derived.d6ROAS,
                d6Con: derived.d6Con,
                signups: row.signups,
                matched_days: row.matched_days,
                daysLive,
                isMatured: daysLive >= 14,
            };
        });
    }

    function createEndpointFindings(source, label, payload) {
        const findings = [];
        const totalRows = Array.isArray(payload.data) ? payload.data.length : 0;
        if (payload.warning) {
            findings.push(makeFinding({
                source,
                checkName: `${label}-warning`,
                status: 'WARN',
                severity: 'warning',
                title: `${label} returned a warning`,
                message: payload.warning,
                detectedValue: totalRows,
            }));
        }
        findings.push(makeFinding({
            source,
            checkName: `${label}-rows`,
            status: totalRows === 0 ? 'FAIL' : 'OK',
            severity: totalRows === 0 ? 'critical' : 'info',
            title: totalRows === 0 ? `${label} returned no rows` : `${label} returned rows`,
            message: totalRows === 0 ? `${label} is empty for the audit range.` : `${label} returned ${totalRows} rows.`,
            detectedValue: totalRows,
            expectedValue: totalRows === 0 ? 1 : null,
        }));
        return findings;
    }

    function createDashboardFindings(source, records, topSpendThreshold = 15000) {
        const findings = [];
        const spenders = records.filter(r => r.spend > 0);
        if (spenders.length === 0) {
            findings.push(makeFinding({
                source,
                checkName: 'dashboard-spend',
                status: 'FAIL',
                severity: 'critical',
                title: 'No spend-bearing dashboard records',
                message: 'Dashboard aggregation produced zero spend-bearing records.',
            }));
            return findings;
        }

        const totalSpend = spenders.reduce((sum, record) => sum + toNumber(record.spend), 0);
        const matchedRecords = spenders.filter(record => toNumber(record.matched_days) > 0);
        const matchedSpend = matchedRecords.reduce((sum, record) => sum + toNumber(record.spend), 0);
        const matchedRecordRate = spenders.length > 0 ? (matchedRecords.length / spenders.length) * 100 : 0;
        const matchedSpendRate = totalSpend > 0 ? (matchedSpend / totalSpend) * 100 : 0;
        findings.push(makeFinding({
            source,
            checkName: 'dashboard-attribution-coverage',
            status: matchedSpendRate < 50 ? 'FAIL' : (matchedSpendRate < 75 ? 'WARN' : 'OK'),
            severity: matchedSpendRate < 50 ? 'critical' : (matchedSpendRate < 75 ? 'warning' : 'info'),
            title: matchedSpendRate < 50 ? 'Attribution spend coverage is low' : (matchedSpendRate < 75 ? 'Attribution spend coverage needs attention' : 'Attribution spend coverage looks healthy'),
            message: `${round1(matchedSpendRate)}% of spend and ${round1(matchedRecordRate)}% of spend-bearing records tie back to at least one matched funnel day.`,
            detectedValue: round1(matchedSpendRate),
            expectedValue: matchedSpendRate < 75 ? 75 : null,
            meta: {
                matchedRecords: matchedRecords.length,
                totalRecords: spenders.length,
                matchedSpend: round1(matchedSpend),
                totalSpend: round1(totalSpend),
            },
        }));

        const zeroRoasCount = spenders.filter(r => !r.d6ROAS).length;
        const zeroRoasRate = (zeroRoasCount / spenders.length) * 100;
        findings.push(makeFinding({
            source,
            checkName: 'dashboard-d6-sparsity',
            status: matchedSpendRate >= 85 && zeroRoasRate > 95 ? 'WARN' : 'OK',
            severity: matchedSpendRate >= 85 && zeroRoasRate > 95 ? 'warning' : 'info',
            title: matchedSpendRate >= 85 && zeroRoasRate > 95 ? 'Matched attribution is present but D6 revenue is almost entirely zero' : 'D6 sparsity is being tracked for context',
            message: matchedSpendRate >= 85 && zeroRoasRate > 95
                ? `${round1(zeroRoasRate)}% of spend-bearing records have zero D6 ROAS even though ${round1(matchedSpendRate)}% of spend is matched. This may indicate delayed or missing revenue attribution.`
                : `${round1(zeroRoasRate)}% of spend-bearing records have zero D6 ROAS. This is logged as performance sparsity and is not treated as an integrity failure by itself.`,
            detectedValue: round1(zeroRoasRate),
            expectedValue: matchedSpendRate >= 85 && zeroRoasRate > 95 ? 95 : null,
            meta: {
                matchedSpendRate: round1(matchedSpendRate),
                matchedRecordRate: round1(matchedRecordRate),
            },
        }));

        const topRoas = buildTopRoasRanking(records, { minSpend: topSpendThreshold });
        const earlyTopRoas = topRoas.filter(r => !r.isMatured);
        const eligibleCandidates = records.filter(record => getEvaluatedD6ROAS(record) > 0 && toNumber(record.spend) > topSpendThreshold);
        const maturedEligible = eligibleCandidates.filter(record => record.isMatured);
        findings.push(makeFinding({
            source,
            checkName: 'dashboard-top-d6-maturity',
            status: earlyTopRoas.length > 0 ? 'WARN' : 'OK',
            severity: earlyTopRoas.length > 0 ? 'warning' : 'info',
            title: earlyTopRoas.length > 0 ? 'Top D6 leaderboard still needs early-data fallback' : 'Top D6 leaderboard is maturity-safe',
            message: earlyTopRoas.length > 0
                ? `${earlyTopRoas.length}/${topRoas.length} top D6 ROAS entries are under 14 days live after the mature-first ranking pass (${maturedEligible.length} matured candidates, ${eligibleCandidates.length} eligible total).`
                : 'Top D6 ROAS candidates are all matured or no eligible rows were found.',
            detectedValue: earlyTopRoas.length,
            expectedValue: earlyTopRoas.length > 0 ? 0 : null,
            meta: earlyTopRoas.length > 0 ? {
                examples: earlyTopRoas.slice(0, 3).map(r => ({
                    name: r.name,
                    daysLive: r.daysLive,
                    d6ROAS: round1(r._rankD6ROAS),
                    dataMode: r._d6DataMode,
                })),
            } : null,
        }));

        return findings;
    }

    function persistRun(result) {
        const startedAt = new Date(result.started_at);
        const completedAt = new Date(result.completed_at);
        const counts = {
            critical: result.findings.filter(f => f.severity === 'critical').length,
            warning: result.findings.filter(f => f.severity === 'warning').length,
            info: result.findings.filter(f => f.severity === 'info').length,
        };

        const runId = insert('fe_data_quality_runs', {
            run_scope: result.scope,
            overall_status: result.overall_status,
            summary_json: JSON.stringify(result.summary),
            checks_run: result.findings.length,
            findings_count: result.findings.length,
            critical_count: counts.critical,
            warning_count: counts.warning,
            info_count: counts.info,
            started_at: result.started_at,
            completed_at: result.completed_at,
            duration_ms: completedAt.getTime() - startedAt.getTime(),
        });

        for (const finding of result.findings) {
            insert('fe_data_quality_findings', {
                run_id: runId,
                source: finding.source,
                check_name: finding.check_name,
                status: finding.status,
                severity: finding.severity,
                title: finding.title,
                message: finding.message,
                detected_value: finding.detected_value,
                expected_value: finding.expected_value,
                meta_json: finding.meta_json,
            });
        }

        return runId;
    }

    function recordAnomaly(finding) {
        if (finding.status === 'OK') return null;
        const scopedTitle = `[${finding.source}] ${finding.title}`;
        const existing = query(
            `SELECT id FROM fe_anomalies
             WHERE anomaly_type = ? AND title = ?
               AND (is_resolved = 0 OR resolved_at >= datetime('now', '-24 hours'))
             LIMIT 1`,
            ['DATA_QUALITY', scopedTitle]
        );
        if (existing.length > 0) return existing[0].id;
        return insert('fe_anomalies', {
            anomaly_type: 'DATA_QUALITY',
            severity: finding.severity,
            title: scopedTitle,
            description: `${finding.source}: ${finding.message}`,
            detected_value: finding.detected_value,
            expected_value: finding.expected_value,
            threshold_violated: finding.check_name,
            is_resolved: 0,
            detected_at: new Date().toISOString(),
        });
    }

    function resolveStaleAnomalies(activeFindings) {
        const activeTitles = activeFindings.map(finding => `[${finding.source}] ${finding.title}`);
        if (activeTitles.length === 0) {
            run(
                `UPDATE fe_anomalies
                 SET is_resolved = 1, resolved_at = ?
                 WHERE anomaly_type = 'DATA_QUALITY'
                   AND is_resolved = 0`,
                [new Date().toISOString()]
            );
            return;
        }

        const placeholders = activeTitles.map(() => '?').join(', ');
        run(
            `UPDATE fe_anomalies
             SET is_resolved = 1, resolved_at = ?
             WHERE anomaly_type = 'DATA_QUALITY'
               AND is_resolved = 0
               AND title NOT IN (${placeholders})`,
            [new Date().toISOString(), ...activeTitles]
        );
    }

    async function runAudit(options = {}) {
        const scope = options.scope || 'all';
        const lookbackDays = Number(options.lookbackDays || DEFAULT_LOOKBACK_DAYS);
        const dateTo = options.dateTo || toIsoDate(new Date());
        const dateFrom = options.dateFrom || toIsoDate(daysAgo(lookbackDays));
        const forceFresh = !!options.forceFresh;
        const startedAt = new Date().toISOString();
        const findings = [];

        console.log(`${PREFIX} Running audit (${dateFrom} -> ${dateTo}, forceFresh=${forceFresh})`);

        try {
            let integrityStatus = null;
            if (forceFresh) {
                const integrityResponse = await requestJson('/api/ci2/integrity/run', { method: 'POST', body: {} });
                const integrityResults = integrityResponse.data || integrityResponse;
                integrityStatus = {
                    status: integrityResults.overallStatus || integrityResults.status,
                    runAt: integrityResults.runAt,
                    summary: integrityResults.summary || null,
                    message: integrityResults.message || null,
                    failedTests: Array.isArray(integrityResults.tests)
                        ? integrityResults.tests.filter(t => !t.pass).map(t => t.name)
                        : (integrityResults.failedTests || []),
                };
            } else {
                const integrityStatusResponse = await requestJson('/api/ci2/integrity/status');
                const integrityData = integrityStatusResponse.data || integrityStatusResponse;
                integrityStatus = {
                    status: integrityData.status,
                    runAt: integrityData.runAt,
                    summary: integrityData.summary || null,
                    message: integrityData.message || null,
                    failedTests: integrityData.failedTests || [],
                };
                const runAt = integrityStatus && integrityStatus.runAt ? new Date(integrityStatus.runAt).getTime() : 0;
                const isStale = !runAt || (Date.now() - runAt) > 6.5 * 60 * 60 * 1000;
                if (isStale) {
                    const integrityResponse = await requestJson('/api/ci2/integrity/run', { method: 'POST', body: {} });
                    const integrityResults = integrityResponse.data || integrityResponse;
                    integrityStatus = {
                        status: integrityResults.overallStatus || integrityResults.status,
                        runAt: integrityResults.runAt,
                        summary: integrityResults.summary || null,
                        message: integrityResults.message || null,
                        failedTests: Array.isArray(integrityResults.tests)
                            ? integrityResults.tests.filter(t => !t.pass).map(t => t.name)
                            : (integrityResults.failedTests || []),
                    };
                }
            }

            const integrityFailedCount = integrityStatus?.summary?.failed ?? integrityStatus?.failedTests?.length ?? null;
            const integrityWarningCount = integrityStatus?.summary?.warnings ?? null;

            findings.push(makeFinding({
                source: 'system',
                checkName: 'ci-integrity-status',
                status: !integrityStatus || integrityStatus.status === 'PENDING' ? 'WARN' : (integrityStatus.status === 'FAIL' ? 'FAIL' : (integrityStatus.status === 'WARN' ? 'WARN' : 'OK')),
                severity: !integrityStatus || integrityStatus.status === 'PENDING' ? 'warning' : (integrityStatus.status === 'FAIL' ? 'critical' : (integrityStatus.status === 'WARN' ? 'warning' : 'info')),
                title: !integrityStatus || integrityStatus.status === 'PENDING'
                    ? 'Creative integrity suite has not produced results yet'
                    : integrityStatus.status === 'FAIL'
                        ? 'Creative integrity suite is failing'
                        : integrityStatus.status === 'WARN'
                            ? 'Creative integrity suite returned warnings'
                            : 'Creative integrity suite is healthy',
                message: !integrityStatus || integrityStatus.status === 'PENDING'
                    ? 'CI integrity status is pending.'
                    : integrityStatus.status === 'FAIL'
                        ? `${integrityFailedCount != null ? integrityFailedCount : 'Some'} CI integrity checks are failing.${integrityStatus.message ? ` ${integrityStatus.message}.` : ''}`
                        : integrityStatus.status === 'WARN'
                            ? `${integrityWarningCount != null ? integrityWarningCount : 'Some'} CI integrity checks are warning.${integrityStatus.message ? ` ${integrityStatus.message}.` : ''}`
                            : `Integrity status ${integrityStatus.status} at ${integrityStatus.runAt}.`,
                detectedValue: integrityStatus.status === 'FAIL' ? integrityFailedCount : integrityWarningCount,
                expectedValue: integrityStatus && integrityStatus.status !== 'OK' ? 0 : null,
                meta: integrityStatus,
            }));

            const recentSchedulerFailures = query(
                `SELECT COUNT(*) AS cnt
                 FROM fe_scheduler_log
                 WHERE status = 'failed'
                   AND started_at >= datetime('now', '-24 hours')`
            )[0]?.cnt || 0;
            findings.push(makeFinding({
                source: 'system',
                checkName: 'scheduler-recent-failures',
                status: recentSchedulerFailures > 0 ? 'WARN' : 'OK',
                severity: recentSchedulerFailures > 0 ? 'warning' : 'info',
                title: recentSchedulerFailures > 0 ? 'Scheduler recorded recent failures' : 'Scheduler has no recent failures',
                message: recentSchedulerFailures > 0
                    ? `${recentSchedulerFailures} scheduler runs failed in the last 24 hours.`
                    : 'No scheduler failures were recorded in the last 24 hours.',
                detectedValue: recentSchedulerFailures,
                expectedValue: recentSchedulerFailures > 0 ? 0 : null,
            }));

            const requestBody = { dateFrom, dateTo, noCache: forceFresh };
            const [metaInsights, metaFunnel, metaStatuses, googleInsights, googleFunnel, googleCampaigns] = await Promise.all([
                requestJson('/api/meta/ad-insights-daily', { method: 'POST', body: requestBody }),
                requestJson('/api/metabase/ad-funnel', { method: 'POST', body: requestBody }),
                requestJson('/api/meta/ads-status'),
                requestJson('/api/google/ad-insights-daily', { method: 'POST', body: requestBody }),
                requestJson('/api/google/ad-funnel', { method: 'POST', body: requestBody }),
                requestJson('/api/google/campaigns'),
            ]);

            findings.push(...createEndpointFindings('meta', 'Meta daily insights', { data: metaInsights.data || [], warning: metaInsights.warning }));
            findings.push(...createEndpointFindings('meta', 'Meta funnel', { data: metaFunnel.data || [], warning: metaFunnel.warning }));
            findings.push(...createEndpointFindings('meta', 'Meta ad status', { data: metaStatuses.data || [], warning: metaStatuses.warning }));
            findings.push(...createEndpointFindings('google', 'Google daily insights', { data: googleInsights.data || [], warning: googleInsights.warning }));
            findings.push(...createEndpointFindings('google', 'Google funnel', { data: googleFunnel.data || [], warning: googleFunnel.warning }));
            findings.push(...createEndpointFindings('google', 'Google campaigns', { data: googleCampaigns.data || [], warning: googleCampaigns.warning }));

            const metaRecords = buildMetaRecords(metaInsights.data || [], metaFunnel.data || [], metaStatuses.data || []);
            const googleRecords = buildGoogleRecords(googleInsights.data || [], googleFunnel.data || []);
            findings.push(...createDashboardFindings('meta', metaRecords));
            findings.push(...createDashboardFindings('google', googleRecords));

            const completedAt = new Date().toISOString();
            const result = {
                scope,
                started_at: startedAt,
                completed_at: completedAt,
                overall_status: summarizeStatuses(findings),
                summary: {
                    dateFrom,
                    dateTo,
                    metaRecords: metaRecords.length,
                    googleRecords: googleRecords.length,
                    statuses: {
                        ok: findings.filter(f => f.status === 'OK').length,
                        warn: findings.filter(f => f.status === 'WARN').length,
                        fail: findings.filter(f => f.status === 'FAIL').length,
                    },
                },
                findings,
                count: findings.length,
            };

            result.run_id = persistRun(result);
            const activeFindings = findings.filter(f => f.status !== 'OK');
            activeFindings.forEach(recordAnomaly);
            resolveStaleAnomalies(activeFindings);
            console.log(`${PREFIX} Audit complete. status=${result.overall_status} findings=${result.findings.length}`);
            return result;
        } catch (err) {
            console.error(`${PREFIX} Audit failed: ${err.message}`);
            const completedAt = new Date().toISOString();
            const failureFinding = makeFinding({
                source: 'system',
                checkName: 'audit-run',
                status: 'FAIL',
                severity: 'critical',
                title: 'Data quality audit failed',
                message: err.message,
            });
            const result = {
                scope,
                started_at: startedAt,
                completed_at: completedAt,
                overall_status: 'FAIL',
                summary: { error: err.message },
                findings: [failureFinding],
                count: 1,
            };
            result.run_id = persistRun(result);
            recordAnomaly(failureFinding);
            return result;
        }
    }

    async function getLatestRun() {
        const run = query(`SELECT * FROM fe_data_quality_runs ORDER BY started_at DESC LIMIT 1`)[0] || null;
        if (!run) return null;
        const findings = query(
            `SELECT * FROM fe_data_quality_findings
             WHERE run_id = ?
             ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, id ASC`,
            [run.id]
        );
        return {
            ...run,
            summary: run.summary_json ? JSON.parse(run.summary_json) : null,
            findings: findings.map(f => ({ ...f, meta: f.meta_json ? JSON.parse(f.meta_json) : null })),
        };
    }

    async function getHistory(limit = 20) {
        const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
        return query(
            `SELECT id, run_scope, overall_status, checks_run, findings_count, critical_count,
                    warning_count, info_count, started_at, completed_at, duration_ms, summary_json
             FROM fe_data_quality_runs
             ORDER BY started_at DESC
             LIMIT ${safeLimit}`
        ).map(row => ({ ...row, summary: row.summary_json ? JSON.parse(row.summary_json) : null }));
    }

    return {
        runAudit,
        getLatestRun,
        getHistory,
    };
};
