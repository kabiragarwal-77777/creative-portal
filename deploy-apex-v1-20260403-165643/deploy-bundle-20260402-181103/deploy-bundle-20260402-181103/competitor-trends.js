/**
 * competitor-trends.js
 * Real-Time Trend Aggregator for Univest Competitor Intelligence portal.
 * Receives classified ad data and computes aggregate trend signals.
 */

module.exports = function (config) {
    const { getClassifiedAds, getUnivest } = config;

    let cachedTrends = null;

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function daysAgo(n) {
        return new Date(Date.now() - n * 86400000);
    }

    function parseDate(dateStr) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d;
    }

    function isActive(ad) {
        // An ad is active if it has no end time or end time is in the future
        if (!ad.ad_delivery_stop_time) return true;
        const stop = parseDate(ad.ad_delivery_stop_time);
        return stop ? stop.getTime() > Date.now() : true;
    }

    function adRunDays(ad) {
        const start = parseDate(ad.ad_delivery_start_time);
        if (!start) return 0;
        const end = ad.ad_delivery_stop_time ? parseDate(ad.ad_delivery_stop_time) : new Date();
        if (!end) return 0;
        return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
    }

    // -------------------------------------------------------------------------
    // computeTrends
    // -------------------------------------------------------------------------

    async function computeTrends() {
        const allAds = await getClassifiedAds();
        const ads = Array.isArray(allAds) ? allAds : [];

        const now = new Date();
        const d14 = daysAgo(14);
        const d28 = daysAgo(28);

        // ---- Partition ads by recency ----
        const recent14 = [];   // last 14 days
        const prior14 = [];    // day 15-28
        const activeAds = [];

        for (const ad of ads) {
            const start = parseDate(ad.ad_delivery_start_time);
            if (start && start >= d14) recent14.push(ad);
            else if (start && start >= d28 && start < d14) prior14.push(ad);
            if (isActive(ad)) activeAds.push(ad);
        }

        // ==== rising_themes & falling_themes ====
        const recentThemeCounts = {};
        const priorThemeCounts = {};

        for (const ad of recent14) {
            const themes = extractThemes(ad);
            for (const t of themes) {
                recentThemeCounts[t] = (recentThemeCounts[t] || 0) + 1;
            }
        }
        for (const ad of prior14) {
            const themes = extractThemes(ad);
            for (const t of themes) {
                priorThemeCounts[t] = (priorThemeCounts[t] || 0) + 1;
            }
        }

        const allThemeKeys = new Set([...Object.keys(recentThemeCounts), ...Object.keys(priorThemeCounts)]);
        const themeGrowth = [];
        for (const theme of allThemeKeys) {
            const recent = recentThemeCounts[theme] || 0;
            const prior = priorThemeCounts[theme] || 0;
            const pctChange = prior === 0
                ? (recent > 0 ? 100 : 0)
                : ((recent - prior) / prior) * 100;
            themeGrowth.push({ theme, recent, prior, pctChange });
        }

        const rising_themes = themeGrowth
            .filter(t => t.pctChange > 0)
            .sort((a, b) => b.pctChange - a.pctChange)
            .map(t => t.theme);

        const falling_themes = themeGrowth
            .filter(t => t.pctChange < 0)
            .sort((a, b) => a.pctChange - b.pctChange)
            .map(t => t.theme);

        // ==== dominant_format_per_competitor ====
        const compFormatCounts = {};  // { competitor: { format: count } }
        for (const ad of ads) {
            const comp = ad.competitor || ad.page_name || 'Unknown';
            const fmt = ad.format_type || ad.format || 'Unknown';
            if (!compFormatCounts[comp]) compFormatCounts[comp] = {};
            compFormatCounts[comp][fmt] = (compFormatCounts[comp][fmt] || 0) + 1;
        }

        const dominant_format_per_competitor = {};
        for (const [comp, formats] of Object.entries(compFormatCounts)) {
            let maxFmt = 'Unknown';
            let maxCount = 0;
            for (const [fmt, count] of Object.entries(formats)) {
                if (count > maxCount) { maxCount = count; maxFmt = fmt; }
            }
            dominant_format_per_competitor[comp] = maxFmt;
        }

        // ==== evergreen_ads (running 30+ days, still active) ====
        const evergreen_ads = activeAds
            .filter(ad => adRunDays(ad) >= 30)
            .map(ad => ({
                id: ad.id || ad.ad_id || null,
                ad_name: ad.ad_name || ad.title || '',
                competitor: ad.competitor || ad.page_name || 'Unknown',
                run_days: adRunDays(ad),
                themes: extractThemes(ad),
            }));

        // ==== new_ads_7d ====
        const d7 = daysAgo(7);
        const new_ads_7d = ads
            .filter(ad => {
                const start = parseDate(ad.ad_delivery_start_time);
                return start && start >= d7;
            })
            .map(ad => ({
                id: ad.id || ad.ad_id || null,
                ad_name: ad.ad_name || ad.title || '',
                competitor: ad.competitor || ad.page_name || 'Unknown',
                start_date: ad.ad_delivery_start_time,
                themes: extractThemes(ad),
            }));

        // ==== dormant_competitors ====
        const compLatest = {};
        for (const ad of ads) {
            const comp = ad.competitor || ad.page_name || 'Unknown';
            const start = parseDate(ad.ad_delivery_start_time);
            if (!start) continue;
            if (!compLatest[comp] || start > compLatest[comp]) {
                compLatest[comp] = start;
            }
        }

        const dormant_competitors = Object.entries(compLatest)
            .filter(([, latest]) => latest < d14)
            .map(([comp]) => comp);

        // ==== hook_frequency ====
        const hook_frequency = {};
        for (const ad of activeAds) {
            const hook = ad.hook_style || ad.hook || null;
            if (hook) {
                hook_frequency[hook] = (hook_frequency[hook] || 0) + 1;
            }
        }

        // ==== platform_shift ====
        const compPlatformCounts = {};  // { competitor: { platform: count } }
        const compPlatformRecent = {};  // { competitor: { platform: count } } last 14d only
        for (const ad of ads) {
            const comp = ad.competitor || ad.page_name || 'Unknown';
            const platform = ad.platform || ad.publisher_platform || 'unknown';
            if (!compPlatformCounts[comp]) compPlatformCounts[comp] = {};
            compPlatformCounts[comp][platform] = (compPlatformCounts[comp][platform] || 0) + 1;

            const start = parseDate(ad.ad_delivery_start_time);
            if (start && start >= d14) {
                if (!compPlatformRecent[comp]) compPlatformRecent[comp] = {};
                compPlatformRecent[comp][platform] = (compPlatformRecent[comp][platform] || 0) + 1;
            }
        }

        const platform_shift = {};
        for (const [comp, platforms] of Object.entries(compPlatformCounts)) {
            // Primary = highest overall count
            let primary = 'unknown';
            let primaryCount = 0;
            for (const [plat, count] of Object.entries(platforms)) {
                if (count > primaryCount) { primaryCount = count; primary = plat; }
            }

            // Trend = platform with highest recent growth that isn't the primary
            let trend = null;
            const recentPlats = compPlatformRecent[comp] || {};
            let maxRecentNonPrimary = 0;
            for (const [plat, count] of Object.entries(recentPlats)) {
                if (plat !== primary && count > maxRecentNonPrimary) {
                    maxRecentNonPrimary = count;
                    trend = `increasing_${plat}`;
                }
            }

            platform_shift[comp] = { primary, trend: trend || `stable_${primary}` };
        }

        // ==== univest_gap_themes ====
        let univest_gap_themes = [];
        try {
            const univestAds = await getUnivest();
            const univestThemes = new Set();
            if (Array.isArray(univestAds)) {
                for (const ad of univestAds) {
                    for (const t of extractThemes(ad)) univestThemes.add(t);
                }
            }

            // Count how many distinct competitors use each theme
            const themeCompetitorSets = {};
            for (const ad of ads) {
                const comp = ad.competitor || ad.page_name || 'Unknown';
                for (const t of extractThemes(ad)) {
                    if (!themeCompetitorSets[t]) themeCompetitorSets[t] = new Set();
                    themeCompetitorSets[t].add(comp);
                }
            }

            univest_gap_themes = Object.entries(themeCompetitorSets)
                .filter(([theme, comps]) => comps.size >= 3 && !univestThemes.has(theme))
                .map(([theme]) => theme);
        } catch (err) {
            console.error('[competitor-trends] Error computing univest_gap_themes:', err.message);
        }

        // ==== Aggregate stats ====
        const allCompetitors = [...new Set(ads.map(a => a.competitor || a.page_name || 'Unknown'))];

        // Most active competitor (most ads in last 14d)
        const compRecent = {};
        for (const ad of recent14) {
            const comp = ad.competitor || ad.page_name || 'Unknown';
            compRecent[comp] = (compRecent[comp] || 0) + 1;
        }
        let most_active_competitor = '';
        let mostActiveCount = 0;
        for (const [comp, count] of Object.entries(compRecent)) {
            if (count > mostActiveCount) { mostActiveCount = count; most_active_competitor = comp; }
        }

        // Most used format overall
        const formatCounts = {};
        for (const ad of ads) {
            const fmt = ad.format_type || ad.format || 'Unknown';
            formatCounts[fmt] = (formatCounts[fmt] || 0) + 1;
        }
        let most_used_format = '';
        let mostFormatCount = 0;
        for (const [fmt, count] of Object.entries(formatCounts)) {
            if (count > mostFormatCount) { mostFormatCount = count; most_used_format = fmt; }
        }

        // Dominant theme overall
        const allThemeCounts = {};
        for (const ad of ads) {
            for (const t of extractThemes(ad)) {
                allThemeCounts[t] = (allThemeCounts[t] || 0) + 1;
            }
        }
        let dominant_theme = '';
        let domThemeCount = 0;
        for (const [t, count] of Object.entries(allThemeCounts)) {
            if (count > domThemeCount) { domThemeCount = count; dominant_theme = t; }
        }

        // Average run duration
        const runDurations = ads.map(ad => adRunDays(ad)).filter(d => d > 0);
        const avg_run_duration = runDurations.length > 0
            ? Math.round(runDurations.reduce((s, d) => s + d, 0) / runDurations.length)
            : 0;

        // Longest running ad
        let longest_running_ad = null;
        let longestDays = 0;
        for (const ad of ads) {
            const days = adRunDays(ad);
            if (days > longestDays) {
                longestDays = days;
                longest_running_ad = {
                    id: ad.id || ad.ad_id || null,
                    ad_name: ad.ad_name || ad.title || '',
                    competitor: ad.competitor || ad.page_name || 'Unknown',
                    run_days: days,
                    start_date: ad.ad_delivery_start_time,
                };
            }
        }

        // Theme distribution
        const theme_distribution = { ...allThemeCounts };

        // Format distribution
        const format_distribution = { ...formatCounts };

        // Competitor activity (ads per competitor in last 14d)
        const competitor_activity = {};
        for (const comp of allCompetitors) {
            competitor_activity[comp] = compRecent[comp] || 0;
        }

        // ==== Build result ====
        cachedTrends = {
            rising_themes,
            falling_themes,
            dominant_format_per_competitor,
            evergreen_ads,
            new_ads_7d,
            dormant_competitors,
            hook_frequency,
            platform_shift,
            univest_gap_themes,
            total_ads_tracked: ads.length,
            total_active_ads: activeAds.length,
            total_competitors: allCompetitors.length,
            most_active_competitor,
            most_used_format,
            dominant_theme,
            avg_run_duration,
            longest_running_ad,
            theme_distribution,
            format_distribution,
            competitor_activity,
            computed_at: new Date().toISOString(),
        };

        console.log(`[competitor-trends] Computed trends: ${ads.length} ads, ${allCompetitors.length} competitors, ${Object.keys(allThemeCounts).length} themes`);
        return cachedTrends;
    }

    // -------------------------------------------------------------------------
    // getTrends — return cached or compute fresh
    // -------------------------------------------------------------------------

    async function getTrends() {
        if (!cachedTrends) {
            return computeTrends();
        }
        return cachedTrends;
    }

    // -------------------------------------------------------------------------
    // extractThemes — normalize theme extraction from an ad object
    // -------------------------------------------------------------------------

    function extractThemes(ad) {
        if (!ad) return [];
        // Support array field
        if (Array.isArray(ad.themes) && ad.themes.length > 0) return ad.themes;
        // Support single string field
        if (typeof ad.theme === 'string' && ad.theme.trim()) return [ad.theme.trim()];
        // Support comma-separated string in themes field
        if (typeof ad.themes === 'string' && ad.themes.trim()) {
            return ad.themes.split(',').map(t => t.trim()).filter(Boolean);
        }
        return [];
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    return { computeTrends, getTrends };
};
