// =============================================================================
// Competitor Creative Briefs Generator
// Takes classified ads + trends + radar insights → generates static & video briefs
// =============================================================================

const OpenAI = require('openai');

module.exports = function(config) {
    const openai = new OpenAI({ apiKey: config.openaiApiKey });

    // In-memory cache
    let cache = {
        static: null,
        video: null,
        timestamp: null,
        stale: false
    };

    // Competitor brief cache: keyed by "competitor|vertical|type"
    let competitorBriefCache = {
        briefs: {},    // { "Samco|Advisory|static": [...], ... }
        timestamp: null,
        stale: false
    };

    // ── Competitor × Vertical Matrix ────────────────────────────────────────

    const COMPETITORS = {
        Advisory: ['Samco', 'StockGro', 'Sensibull', 'Definedge', 'Weekend Investing', 'Capitalmind'],
        Broking: ['Zerodha', 'Groww', 'Angel One', 'Upstox', '5paisa', 'Dhan'],
        MFA: ['Groww MF', 'Zerodha Coin', 'Paytm Money', 'ET Money', 'Kuvera']
    };

    const VERTICAL_CONTEXT = {
        Advisory: 'SEBI Registered Research Analyst advisory. ₹1 trial offer for 7 days. Expert-curated stock picks with entry/exit/SL. Target: retail investors wanting guided stock market advice.',
        Broking: 'Demat & trading account. ₹0 brokerage on equity delivery. Seamless UPI-based account opening. Target: new & active traders looking for low-cost execution.',
        MFA: 'Mutual Fund Advisor / SIP platform. Free portfolio review, goal-based SIP recommendations, direct MF plans. Target: passive investors & SIP starters.'
    };

    // ── Helpers ──────────────────────────────────────────────────────────────

    function parseAIJson(raw) {
        if (!raw || typeof raw !== 'string') throw new Error('Empty AI response');
        // Strip markdown code fences
        let clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
        // Sometimes the model wraps in extra text before/after the array
        const arrStart = clean.indexOf('[');
        const arrEnd = clean.lastIndexOf(']');
        if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
            clean = clean.substring(arrStart, arrEnd + 1);
        }
        return JSON.parse(clean);
    }

    function buildContext(trends, classifiedAds, radar, apifySignals) {
        // trends is an object like { rising_themes, theme_distribution, hook_frequency, univest_gap_themes, evergreen_ads, ... }
        const t = trends || {};

        // Extract top themes from theme_distribution or rising_themes
        let topThemesList = [];
        if (t.theme_distribution && typeof t.theme_distribution === 'object') {
            topThemesList = Object.entries(t.theme_distribution)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([k]) => k);
        } else if (Array.isArray(t.rising_themes)) {
            topThemesList = t.rising_themes.slice(0, 8).map(x => typeof x === 'string' ? x : (x.theme || x.name || ''));
        }
        const topThemes = topThemesList.filter(Boolean).join(', ') || 'Stock tips, Portfolio growth, Market predictions, Expert research';

        // Extract top hooks from hook_frequency
        let topHooks = [];
        if (t.hook_frequency && typeof t.hook_frequency === 'object') {
            topHooks = Object.entries(t.hook_frequency)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([k]) => k);
        }
        if (topHooks.length === 0) {
            topHooks.push('Join 10L+ investors', 'Expert-backed stock picks', 'Start with just Rs 1');
        }
        const topHooksStr = topHooks.join(' | ');

        // Evergreen / top-performer examples from trends.evergreen_ads or classifiedAds
        const evergreenSource = Array.isArray(t.evergreen_ads) && t.evergreen_ads.length > 0
            ? t.evergreen_ads
            : (classifiedAds || []).filter(a => a.is_evergreen || a.run_days > 30);
        const evergreen = evergreenSource.slice(0, 5);
        const evergreenText = evergreen.length > 0
            ? evergreen.map(a => {
                const parts = [];
                if (a.page_name || a.advertiser || a.brand) parts.push('Brand: ' + (a.page_name || a.advertiser || a.brand));
                if (a.ad_creative_body || a.hook || a.headline) parts.push('Hook: ' + (a.ad_creative_body || a.hook || a.headline || '').substring(0, 80));
                if (a.theme) parts.push('Theme: ' + a.theme);
                if (a.run_days || a.days_active) parts.push('Active: ' + (a.run_days || a.days_active) + ' days');
                if (a.format) parts.push('Format: ' + a.format);
                return parts.join(', ');
            }).join('\n')
            : 'No specific evergreen examples available — use general fintech ad best practices';

        // Gaps from trends.univest_gap_themes or radar insights
        let gapThemes;
        if (Array.isArray(t.univest_gap_themes) && t.univest_gap_themes.length > 0) {
            gapThemes = t.univest_gap_themes.slice(0, 5).join(', ');
        } else {
            const radarItems = Array.isArray(radar) ? radar : (radar && Array.isArray(radar.insights) ? radar.insights : []);
            gapThemes = radarItems
                .filter(r => r.type === 'gap' || r.category === 'gap' || r.gap || (r.title && /gap|missing|opportunity/i.test(r.title)))
                .slice(0, 5)
                .map(r => r.gap || r.title || r.insight || r.description || '')
                .filter(Boolean)
                .join(', ') || 'UGC-style testimonials, Hinglish copy, Short-form video hooks, Price-anchoring with trial offer';
        }

        return { topThemes, topHooksStr, evergreenText, gapThemes, apifySignals: apifySignals || null };
    }

    // ── Static Brief Generation ─────────────────────────────────────────────

    async function generateStaticBriefs(ctx) {
        const systemPrompt = 'You are a senior creative strategist at a fintech performance marketing agency.';

        const userPrompt = `Competitor data shows these winning patterns for Indian stock market ads:
- Top themes: ${ctx.topThemes}
- Top hooks: ${ctx.topHooksStr}
- Evergreen ad examples: ${ctx.evergreenText}
- Univest gaps: ${ctx.gapThemes}
${ctx.apifySignals ? `- Apify enrichment: ${JSON.stringify(ctx.apifySignals, null, 2)}` : ''}

Generate 3 static ad briefs for Univest (Research Advisory product, ₹1 trial offer). Each brief must include:
- concept_name: creative concept name
- hook_line: first line of the ad (attention grabber)
- body_direction: 2-3 lines of body copy direction
- visual_direction: background, key elements, color recommendation
- rationale: which competitor pattern this is based on and why it will work for Univest
- suggested_cta: call to action text
- format: "Square 1080x1080"

Return ONLY valid JSON array of 3 objects with these exact keys, no preamble.`;

        const response = await openai.chat.completions.create({
            model: 'gpt-5.4-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.8,
            max_completion_tokens: 3000
        });

        const raw = response.choices[0].message.content;
        return parseAIJson(raw);
    }

    // ── Video Script Brief Generation ───────────────────────────────────────

    async function generateVideoBriefs(ctx) {
        const systemPrompt = 'You are a senior creative strategist at a fintech performance marketing agency.';

        const userPrompt = `Competitor data shows these winning patterns for Indian stock market video ads:
- Top themes: ${ctx.topThemes}
- Top hooks: ${ctx.topHooksStr}
- Evergreen ad examples: ${ctx.evergreenText}
- Univest gaps: ${ctx.gapThemes}
${ctx.apifySignals ? `- Apify enrichment: ${JSON.stringify(ctx.apifySignals, null, 2)}` : ''}

Generate 3 video ad script briefs for Univest (Research Advisory product, ₹1 trial offer). Each brief must include:
- concept_name: creative concept name
- scene_1: Hook/attention grabber (0-3s)
- scene_2: Problem/context (3-10s)
- scene_3: Solution/Univest offer (10-20s)
- scene_4: CTA (20-30s)
- voiceover_tone: (Calm authority / High energy / Conversational Hinglish / etc.)
- visual_style: (Screen recording / Talking head / Motion graphics / UGC-style)
- rationale: which competitor pattern this is based on
- suggested_cta: call to action text

Return ONLY valid JSON array of 3 objects with these exact keys, no preamble.`;

        const response = await openai.chat.completions.create({
            model: 'gpt-5.4-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.8,
            max_completion_tokens: 3000
        });

        const raw = response.choices[0].message.content;
        return parseAIJson(raw);
    }

    // ── Competitor-Specific Brief Generation ────────────────────────────────

    async function generateCompetitorBrief(competitor, vertical, competitorAds, briefType) {
        const verticalContext = VERTICAL_CONTEXT[vertical] || VERTICAL_CONTEXT.Advisory;

        // Summarize competitor ads for the prompt
        const adSummary = (competitorAds || []).slice(0, 10).map(a => {
            const parts = [];
            if (a.ad_creative_body || a.hook || a.headline) parts.push('Copy: ' + (a.ad_creative_body || a.hook || a.headline || '').substring(0, 120));
            if (a.theme) parts.push('Theme: ' + a.theme);
            if (a.format) parts.push('Format: ' + a.format);
            if (a.run_days || a.days_active) parts.push('Active: ' + (a.run_days || a.days_active) + ' days');
            if (a.impressions) parts.push('Impressions: ' + JSON.stringify(a.impressions));
            return parts.join(', ');
        }).filter(Boolean).join('\n') || 'No specific ads available for this competitor.';

        const systemPrompt = 'You are a senior creative strategist at a fintech performance marketing agency specializing in competitive counter-positioning.';

        if (briefType === 'static') {
            const userPrompt = `COMPETITOR: ${competitor}
VERTICAL: ${vertical} — ${verticalContext}

${competitor}'s current ads:
${adSummary}

Generate 2 static ad briefs for Univest to counter ${competitor} in the ${vertical} vertical. Each brief must include:
- concept_name: creative concept name
- competitor: "${competitor}"
- vertical: "${vertical}"
- hook_line: first line of the ad (attention grabber)
- body_direction: 2-3 lines of body copy direction
- visual_direction: background, key elements, color recommendation
- rationale: which ${competitor} pattern this counters and why it will work for Univest
- suggested_cta: call to action text
- format: "Square 1080x1080"
- competitive_angle: object with keys:
  - what_they_say: what ${competitor} claims in their ads
  - what_we_counter: Univest's counter-message
  - gap_we_exploit: the positioning gap we exploit

Return ONLY valid JSON array of 2 objects with these exact keys, no preamble.`;

            const response = await openai.chat.completions.create({
                model: 'gpt-5.4-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.8,
                max_completion_tokens: 3000
            });

            const briefs = parseAIJson(response.choices[0].message.content);
            return briefs.map(b => ({ ...b, type: 'static', competitor, vertical }));
        } else {
            // Video brief — full production format
            const userPrompt = `COMPETITOR: ${competitor}
VERTICAL: ${vertical} — ${verticalContext}

${competitor}'s current ads:
${adSummary}

Generate 2 video ad script briefs for Univest to counter ${competitor} in the ${vertical} vertical. Each brief must be a FULL PRODUCTION FORMAT with:
- concept_name: creative concept name
- competitor: "${competitor}"
- vertical: "${vertical}"
- hook: object with keys:
  - line: the opening hook line (0-3s)
  - visual: what's on screen
  - talent_direction: how the talent should deliver it
- problem: object with keys:
  - line: problem statement script (3-8s)
  - visual: what's on screen
  - talent_direction: delivery notes
- solution: object with keys:
  - line: Univest solution pitch (8-18s)
  - visual: what's on screen (app demo, screen recording, etc.)
  - talent_direction: delivery notes
- proof: object with keys:
  - line: social proof / credibility (18-23s)
  - visual: what's on screen
- cta: object with keys:
  - line: call to action (23-30s)
  - visual: end card direction
  - suggested_cta_text: button/overlay text
- production_notes: object with keys:
  - voiceover_tone: (Calm authority / High energy / Conversational Hinglish / etc.)
  - visual_style: (Screen recording / Talking head / Motion graphics / UGC-style)
  - ugc_notes: UGC recommendations if applicable
  - music: background music/sound direction
  - shooting_setup: camera, lighting, location notes
- competitive_angle: object with keys:
  - what_they_say: what ${competitor} claims in their ads
  - what_we_counter: Univest's counter-message
  - gap_we_exploit: the positioning gap we exploit
- rationale: which ${competitor} pattern this counters and why

Return ONLY valid JSON array of 2 objects with these exact keys, no preamble.`;

            const response = await openai.chat.completions.create({
                model: 'gpt-5.4-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.8,
                max_completion_tokens: 4000
            });

            const briefs = parseAIJson(response.choices[0].message.content);
            return briefs.map(b => ({ ...b, type: 'video', competitor, vertical }));
        }
    }

    async function generateCompetitorBriefMatrix() {
        console.log('[Briefs] Starting competitor brief matrix generation...');
        const allBriefs = {};
        const errors = [];

        // Get classified ads for competitor matching
        let classifiedAds = [];
        try {
            classifiedAds = await safeCall(config.getClassifiedAds);
        } catch (err) {
            console.error('[Briefs] Could not load classified ads for matrix:', err.message);
        }

        for (const [vertical, competitors] of Object.entries(COMPETITORS)) {
            for (const competitor of competitors) {
                // Filter ads for this competitor
                const competitorAds = (classifiedAds || []).filter(a => {
                    const name = (a.page_name || a.advertiser || a.brand || '').toLowerCase();
                    return name.includes(competitor.toLowerCase());
                });

                for (const briefType of ['static', 'video']) {
                    const cacheKey = `${competitor}|${vertical}|${briefType}`;
                    try {
                        console.log(`[Briefs] Generating ${briefType} briefs: ${competitor} × ${vertical}`);
                        const result = await generateCompetitorBrief(competitor, vertical, competitorAds, briefType);
                        allBriefs[cacheKey] = result;
                    } catch (err) {
                        console.error(`[Briefs] Failed ${cacheKey}:`, err.message);
                        errors.push({ competitor, vertical, briefType, error: err.message });
                    }
                }
            }
        }

        competitorBriefCache = {
            briefs: allBriefs,
            timestamp: Date.now(),
            stale: errors.length > 0
        };

        console.log(`[Briefs] Matrix complete. Generated ${Object.keys(allBriefs).length} sets, ${errors.length} errors.`);

        return {
            generated: Object.keys(allBriefs).length,
            errors: errors.length,
            error_details: errors,
            timestamp: new Date(competitorBriefCache.timestamp).toISOString()
        };
    }

    function getCompetitorBriefs(filters) {
        if (!competitorBriefCache.timestamp) {
            return { briefs: [], timestamp: null, stale: false, message: 'No competitor briefs generated yet. Call generateCompetitorBriefMatrix() first.' };
        }

        const { competitor, vertical, type } = filters || {};
        let allBriefs = [];

        for (const [key, briefList] of Object.entries(competitorBriefCache.briefs)) {
            const [bCompetitor, bVertical, bType] = key.split('|');

            if (competitor && bCompetitor.toLowerCase() !== competitor.toLowerCase()) continue;
            if (vertical && bVertical.toLowerCase() !== vertical.toLowerCase()) continue;
            if (type && bType.toLowerCase() !== type.toLowerCase()) continue;

            allBriefs = allBriefs.concat(briefList);
        }

        return {
            briefs: allBriefs,
            count: allBriefs.length,
            filters: { competitor: competitor || 'all', vertical: vertical || 'all', type: type || 'all' },
            generated_at: competitorBriefCache.timestamp ? new Date(competitorBriefCache.timestamp).toISOString() : null,
            timestamp: competitorBriefCache.timestamp,
            stale: competitorBriefCache.stale
        };
    }

    // ── Main Orchestrator ───────────────────────────────────────────────────

    async function generateBriefs() {
        let trends, classifiedAds, radar, apifySignals;

        try {
            [trends, classifiedAds, radar] = await Promise.all([
                safeCall(config.getTrends),
                safeCall(config.getClassifiedAds),
                safeCall(config.getRadar)
            ]);
            apifySignals = await safeCall(config.getApifyInsights);
        } catch (err) {
            console.error('[Briefs] Failed to gather input data:', err.message);
            if (cache.timestamp) {
                cache.stale = true;
                return getBriefs('all');
            }
            throw new Error('Cannot generate briefs: failed to load input data — ' + err.message);
        }

        const ctx = buildContext(trends, classifiedAds, radar, apifySignals);

        let staticBriefs, videoBriefs;
        let staticErr = null, videoErr = null;

        // Run both in parallel
        const [staticResult, videoResult] = await Promise.allSettled([
            generateStaticBriefs(ctx),
            generateVideoBriefs(ctx)
        ]);

        if (staticResult.status === 'fulfilled') {
            staticBriefs = staticResult.value;
        } else {
            staticErr = staticResult.reason;
            console.error('[Briefs] Static generation failed:', staticErr.message);
            staticBriefs = cache.static; // fallback to cached
        }

        if (videoResult.status === 'fulfilled') {
            videoBriefs = videoResult.value;
        } else {
            videoErr = videoResult.reason;
            console.error('[Briefs] Video generation failed:', videoErr.message);
            videoBriefs = cache.video; // fallback to cached
        }

        // If both failed entirely and no cache
        if (!staticBriefs && !videoBriefs) {
            throw new Error('Brief generation failed: ' + (staticErr || videoErr).message);
        }

        // Tag briefs with type
        if (staticBriefs) {
            staticBriefs = staticBriefs.map(b => ({ ...b, type: 'static' }));
        }
        if (videoBriefs) {
            videoBriefs = videoBriefs.map(b => ({ ...b, type: 'video' }));
        }

        // Determine staleness
        const isPartiallyStale = !!(staticErr || videoErr);

        cache = {
            static: staticBriefs || cache.static,
            video: videoBriefs || cache.video,
            timestamp: Date.now(),
            stale: isPartiallyStale
        };

        return getBriefs('all');
    }

    function getBriefs(type) {
        if (!cache.timestamp) {
            return { briefs: [], timestamp: null, stale: false, message: 'No briefs generated yet. Call generateBriefs() first.' };
        }

        let briefs = [];
        if (type === 'static') {
            briefs = cache.static || [];
        } else if (type === 'video') {
            briefs = cache.video || [];
        } else {
            briefs = [].concat(cache.static || []).concat(cache.video || []);
        }

        return {
            briefs,
            static: cache.static || [],
            video: cache.video || [],
            generated_at: cache.timestamp ? new Date(cache.timestamp).toISOString() : null,
            timestamp: cache.timestamp,
            stale: cache.stale,
            static_count: (cache.static || []).length,
            video_count: (cache.video || []).length
        };
    }

    async function refreshBriefs() {
        // Force regeneration — clear stale flag first
        cache.stale = false;
        return generateBriefs();
    }

    // ── Utility ─────────────────────────────────────────────────────────────

    async function safeCall(fn) {
        if (typeof fn !== 'function') return [];
        try {
            const result = await fn();
            return result || [];
        } catch (err) {
            console.error('[Briefs] safeCall error:', err.message);
            return [];
        }
    }

    return {
        generateBriefs,
        getBriefs,
        refreshBriefs,
        generateCompetitorBrief,
        generateCompetitorBriefMatrix,
        getCompetitorBriefs,
        COMPETITORS
    };
};
