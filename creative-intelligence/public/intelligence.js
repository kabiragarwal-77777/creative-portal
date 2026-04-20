(function() {
    'use strict';

    /* ─── helpers ─── */
    function esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    var SYSTEM_PROMPT = 'You are a senior performance marketing analyst embedded at Univest, ' +
        'an Indian fintech company. You have deep expertise in Meta advertising for subscription financial products.\n\n' +
        'UNIVEST\'S FUNNEL (memorize this):\n' +
        'Ad \u2192 Install \u2192 Signup \u2192 D0 Trial \u2192 D0 Payment \u2192 D6 Payment \u2192 Renewals \u2192 Overall Revenue\n\n' +
        'YOUR ANALYSIS MUST:\n' +
        '1. Always cite specific creative names and exact numbers \u2014 never say "some creatives" or "many ads"\n' +
        '2. Compare every metric to the portfolio benchmark provided \u2014 state whether above/below and by how much\n' +
        '3. Separate Video and Static analysis completely \u2014 they have different KPIs\n' +
        '4. For Video: lead with Hook Rate and Hold Rate as primary diagnostic signals\n' +
        '5. For Static: lead with CTR and Signup Rate as primary diagnostic signals\n' +
        '6. Funnel drop-off analysis is mandatory \u2014 identify the exact step where each creative loses users\n' +
        '7. Every insight must end with a specific, implementable action (pause / increase budget / test variation / copy the hook)\n' +
        '8. LTV insights must use actual revenue figures from the data, never invent numbers\n' +
        '9. Flag any creative where D6 ROAS > Overall ROAS \u2014 this signals churn after D6, needs investigation\n' +
        '10. Flag any creative where Signup Rate is high but D0Trial Rate is low \u2014 traffic quality issue\n\n' +
        'WHAT BAD INSIGHTS LOOK LIKE (never produce these):\n' +
        '- "Creative A performs well across multiple metrics" \u2190 vague\n' +
        '- "Consider optimizing your creative strategy" \u2190 not actionable\n' +
        '- "Video content shows strong engagement" \u2190 no numbers, no action\n' +
        '- "LTV is estimated at \u20b9X" without citing which actual revenue data supports this\n\n' +
        'WHAT GOOD INSIGHTS LOOK LIKE:\n' +
        '- "FB_MOF_Video_Pranit_V2 has 34% hook rate (portfolio median: 22%) but only 8% D0Trial-to-D6 rate (median: 18%) \u2014 strong top-of-funnel but poor conversion quality. Test narrowing to users who viewed 75%+ of video."\n' +
        '- "FB_Static_ZeroBrokerage has \u20b989 CPI (36% below portfolio median \u20b9139) but 6% signup rate (median 14%) \u2014 cheap installs, low quality. Pause and test with a friction-reducing landing page variant."';

    function buildIntelligencePrompt(ctx) {
        return 'Analyze Univest\'s Meta ad creative performance. Here is the complete dataset:\n\n' +
            'PORTFOLIO BENCHMARKS:\n' + JSON.stringify(ctx.univest_context.current_benchmarks, null, 2) +
            '\n\nDATA COVERAGE:\n- Total creatives with spend data: ' + ctx.data_quality.with_spend_data +
            '\n- Creatives with D6 conversion data: ' + ctx.data_quality.with_d6_data +
            '\n- Creatives with revenue data: ' + ctx.data_quality.with_revenue_data +
            '\n- Videos: ' + ctx.data_quality.video_count + ' | Statics: ' + ctx.data_quality.static_count +
            '\n\nTOP 20 CREATIVES BY D6 ROAS:\n' + JSON.stringify(ctx.top_20_by_d6_roas, null, 2) +
            '\n\nBOTTOM 20 CREATIVES BY D6 ROAS:\n' + JSON.stringify(ctx.bottom_20_by_d6_roas, null, 2) +
            '\n\nCURRENTLY LIVE CREATIVES:\n' + JSON.stringify(ctx.live_creatives, null, 2) +
            '\n\nACTUAL REVENUE DATA (for LTV grounding):\n' + JSON.stringify(ctx.ltv_data, null, 2) +
            '\n\nGenerate a complete analysis with this exact JSON structure:\n' +
            '{\n' +
            '  "executive_summary": "3 sentences max. What is working, what isn\'t, the single most urgent action. Cite 2+ specific creative names.",\n' +
            '  "top_performer_analysis": [{ "creative_name":"", "why_it_wins":"", "key_metric":"", "key_metric_value":"", "funnel_strength":"", "recommended_action":"", "budget_recommendation":"" }],\n' +
            '  "underperformer_diagnosis": [{ "creative_name":"", "spend_wasted":"", "funnel_breakdown":"", "root_cause":"", "fix_or_kill":"", "specific_fix":"" }],\n' +
            '  "video_insights": { "hook_rate_analysis":"", "hold_rate_analysis":"", "hook_to_conversion_gap":"", "best_hook_formula":"", "worst_hook_patterns":"" },\n' +
            '  "static_insights": { "ctr_analysis":"", "ctr_to_signup_efficiency":"", "best_static_formula":"", "underperforming_statics":"" },\n' +
            '  "funnel_analysis": { "biggest_drop_off_step":"", "best_install_to_signup":"", "best_d0trial_to_d6":"", "p0p1_quality_leaders":"" },\n' +
            '  "ltv_insights": { "actual_revenue_per_signup":"", "d6_to_overall_multiplier":"", "best_ltv_creatives":"", "d6_roas_vs_overall_roas_gap":"", "ltv_by_type":"" },\n' +
            '  "live_creative_alerts": [{ "creative_name":"", "current_d6_roas":"", "vs_benchmark":"", "action":"SCALE/MAINTAIN/PAUSE/WATCH" }],\n' +
            '  "quick_wins": [{ "action":"", "rationale":"", "expected_impact":"", "effort":"LOW/MEDIUM/HIGH" }]\n' +
            '}\n\nReturn valid JSON only. No markdown, no prose outside the JSON.';
    }

    /* ─── section styles ─── */
    var CS = 'background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;';
    var CARD = 'background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:16px;';

    function sectionHeader(title, id) {
        return '<div style="' + CS + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="var b=document.getElementById(\'' + id + '\');b.style.display=b.style.display===\'none\'?\'\':\'none\';">' +
                '<h3 style="font-size:15px;font-weight:600;color:var(--text);margin:0;">' + title + '</h3>' +
                '<span style="color:var(--text-dim);font-size:12px;">&#9660;</span>' +
            '</div>' +
            '<div id="' + id + '" style="margin-top:16px;">';
    }
    function sectionEnd() { return '</div></div>'; }

    function alertColor(action) {
        if (!action) return 'var(--text-dim)';
        var a = action.toUpperCase();
        if (a === 'SCALE') return 'var(--green)';
        if (a === 'MAINTAIN' || a === 'WATCH') return 'var(--orange)';
        if (a === 'PAUSE') return 'var(--red)';
        return 'var(--accent)';
    }

    function effortColor(e) {
        if (!e) return 'var(--text-dim)';
        var l = e.toUpperCase();
        if (l === 'LOW') return 'var(--green)';
        if (l === 'MEDIUM') return 'var(--orange)';
        return 'var(--red)';
    }

    /* ─── render sections ─── */

    function renderExecutiveSummary(data) {
        if (!data.executive_summary) return '';
        return '<div style="' + CS + 'border-left:4px solid var(--gold, #eab308);">' +
            '<h3 style="font-size:14px;font-weight:700;color:var(--gold, #eab308);margin-bottom:10px;">Executive Summary</h3>' +
            '<p style="font-size:14px;color:var(--text);line-height:1.7;">' + esc(data.executive_summary) + '</p>' +
        '</div>';
    }

    function renderQuickWins(wins) {
        if (!wins || !wins.length) return '';
        var html = '<div style="' + CS + '">' +
            '<h3 style="font-size:15px;font-weight:600;margin-bottom:14px;color:var(--green);">&#9889; Quick Wins — Do This Week</h3>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">';
        wins.forEach(function(w) {
            html += '<div style="' + CARD + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
                    '<span style="font-size:13px;font-weight:600;color:var(--text);">' + esc(w.action) + '</span>' +
                    '<span style="padding:2px 10px;border-radius:10px;font-size:10px;font-weight:700;color:#fff;background:' + effortColor(w.effort) + ';">' + esc(w.effort) + '</span>' +
                '</div>' +
                '<p style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">' + esc(w.rationale) + '</p>' +
                '<p style="font-size:12px;color:var(--green);font-weight:500;">' + esc(w.expected_impact) + '</p>' +
            '</div>';
        });
        html += '</div></div>';
        return html;
    }

    function renderLiveAlerts(alerts) {
        if (!alerts || !alerts.length) return '';
        var html = sectionHeader('&#128680; Live Creative Alerts', 'sec_live_alerts');
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
            '<thead><tr style="border-bottom:2px solid var(--border);">' +
                '<th style="text-align:left;padding:10px 8px;color:var(--text-dim);">Creative</th>' +
                '<th style="text-align:right;padding:10px 8px;color:var(--text-dim);">D6 ROAS</th>' +
                '<th style="text-align:left;padding:10px 8px;color:var(--text-dim);">vs Benchmark</th>' +
                '<th style="text-align:center;padding:10px 8px;color:var(--text-dim);">Action</th>' +
            '</tr></thead><tbody>';
        alerts.forEach(function(a) {
            var col = alertColor(a.action);
            html += '<tr style="border-bottom:1px solid var(--border);">' +
                '<td style="padding:8px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(a.creative_name) + '">' + esc(a.creative_name) + '</td>' +
                '<td style="text-align:right;padding:8px;font-weight:600;">' + esc(a.current_d6_roas) + '</td>' +
                '<td style="padding:8px;color:var(--text-dim);">' + esc(a.vs_benchmark) + '</td>' +
                '<td style="text-align:center;padding:8px;"><span style="padding:3px 12px;border-radius:12px;font-size:10px;font-weight:700;color:#fff;background:' + col + ';">' + esc(a.action) + '</span></td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        html += sectionEnd();
        return html;
    }

    function renderPerformersGrid(data) {
        var tops = data.top_performer_analysis || [];
        var bottoms = data.underperformer_diagnosis || [];
        if (!tops.length && !bottoms.length) return '';

        var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">';

        // Top performers
        html += '<div style="' + CS + 'border-top:3px solid var(--green);">' +
            '<h3 style="font-size:14px;font-weight:600;color:var(--green);margin-bottom:14px;">&#9650; Top Performers</h3>';
        tops.forEach(function(t) {
            html += '<div style="' + CARD + 'margin-bottom:10px;">' +
                '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px;">' + esc(t.creative_name) + '</div>' +
                '<p style="font-size:12px;color:var(--text-dim);line-height:1.6;margin-bottom:6px;">' + esc(t.why_it_wins) + '</p>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;">' +
                    '<span style="font-size:11px;padding:2px 8px;background:rgba(34,197,94,0.15);color:var(--green);border-radius:6px;">' + esc(t.key_metric) + ': ' + esc(t.key_metric_value) + '</span>' +
                    '<span style="font-size:11px;padding:2px 8px;background:rgba(99,102,241,0.15);color:var(--accent);border-radius:6px;">' + esc(t.funnel_strength) + '</span>' +
                '</div>' +
                '<p style="font-size:12px;color:var(--accent);font-weight:500;">' + esc(t.recommended_action) + '</p>' +
                (t.budget_recommendation ? '<p style="font-size:11px;color:var(--text-dim);">Budget: ' + esc(t.budget_recommendation) + '</p>' : '') +
            '</div>';
        });
        html += '</div>';

        // Underperformers
        html += '<div style="' + CS + 'border-top:3px solid var(--red);">' +
            '<h3 style="font-size:14px;font-weight:600;color:var(--red);margin-bottom:14px;">&#9660; Underperformers</h3>';
        bottoms.forEach(function(b) {
            html += '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--red);">' +
                '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;">' + esc(b.creative_name) + '</div>' +
                '<div style="font-size:11px;color:var(--red);margin-bottom:6px;">' + esc(b.spend_wasted) + '</div>' +
                '<p style="font-size:12px;color:var(--text-dim);line-height:1.6;margin-bottom:6px;">' + esc(b.funnel_breakdown) + '</p>' +
                '<p style="font-size:12px;color:var(--orange);margin-bottom:4px;"><strong>Root cause:</strong> ' + esc(b.root_cause) + '</p>' +
                '<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">' +
                    '<span style="padding:3px 10px;border-radius:8px;font-size:10px;font-weight:700;color:#fff;background:' + (b.fix_or_kill && b.fix_or_kill.indexOf('PAUSE') === 0 ? 'var(--red)' : 'var(--orange)') + ';">' + esc(b.fix_or_kill) + '</span>' +
                '</div>' +
                (b.specific_fix ? '<p style="font-size:11px;color:var(--text-dim);font-style:italic;">' + esc(b.specific_fix) + '</p>' : '') +
            '</div>';
        });
        html += '</div></div>';
        return html;
    }

    function renderInsightsSection(title, id, obj, icon) {
        if (!obj) return '';
        var keys = Object.keys(obj);
        if (!keys.length) return '';
        var html = sectionHeader(icon + ' ' + title, id);
        keys.forEach(function(k) {
            var label = k.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
            html += '<div style="margin-bottom:12px;">' +
                '<div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:4px;">' + esc(label) + '</div>' +
                '<p style="font-size:13px;color:var(--text);line-height:1.6;">' + esc(obj[k]) + '</p>' +
            '</div>';
        });
        html += sectionEnd();
        return html;
    }

    function renderFunnelAnalysis(data) {
        var f = data.funnel_analysis;
        if (!f) return '';
        var html = sectionHeader('&#9888; Funnel Analysis', 'sec_funnel');

        // Funnel visualization bar
        var steps = ['Install', 'Signup', 'D0 Trial', 'D6'];
        html += '<div style="display:flex;gap:4px;margin-bottom:16px;align-items:center;">';
        steps.forEach(function(s, i) {
            var width = (100 - i * 20) + '%';
            html += '<div style="flex:1;text-align:center;">' +
                '<div style="height:24px;background:linear-gradient(90deg, var(--accent), var(--green));border-radius:4px;opacity:' + (1 - i * 0.2) + ';"></div>' +
                '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + s + '</div>' +
            '</div>';
            if (i < steps.length - 1) html += '<div style="color:var(--text-dim);font-size:14px;">\u2192</div>';
        });
        html += '</div>';

        if (f.biggest_drop_off_step) {
            html += '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--red);">' +
                '<div style="font-size:12px;font-weight:600;color:var(--red);margin-bottom:4px;">Biggest Drop-off</div>' +
                '<p style="font-size:13px;color:var(--text);line-height:1.6;">' + esc(f.biggest_drop_off_step) + '</p>' +
            '</div>';
        }
        var fields = ['best_install_to_signup', 'best_d0trial_to_d6', 'p0p1_quality_leaders'];
        fields.forEach(function(k) {
            if (!f[k]) return;
            var label = k.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
            html += '<div style="margin-bottom:10px;">' +
                '<div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:4px;">' + esc(label) + '</div>' +
                '<p style="font-size:13px;color:var(--text);line-height:1.6;">' + esc(f[k]) + '</p>' +
            '</div>';
        });

        html += sectionEnd();
        return html;
    }

    function renderLTVInsights(data) {
        var l = data.ltv_insights;
        if (!l) return '';
        var html = sectionHeader('&#128176; LTV Insights (Actual Revenue Data)', 'sec_ltv');
        var keys = Object.keys(l);
        keys.forEach(function(k) {
            var label = k.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
            var val = l[k];
            // Highlight ₹ figures in green
            var hasRupee = val && val.indexOf('\u20b9') !== -1;
            html += '<div style="margin-bottom:10px;">' +
                '<div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:4px;">' + esc(label) + '</div>' +
                '<p style="font-size:13px;color:' + (hasRupee ? 'var(--green)' : 'var(--text)') + ';line-height:1.6;font-weight:' + (hasRupee ? '600' : '400') + ';">' + esc(val) + '</p>' +
            '</div>';
        });
        html += sectionEnd();
        return html;
    }

    /* ─── main render ─── */
    function renderIntelligence(raw, container) {
        var data;
        if (typeof raw === 'string') {
            var cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
            try { data = JSON.parse(cleaned); } catch (e) {
                container.innerHTML = '<div style="' + CS + 'color:var(--red);">' +
                    '<h3>Parse Error</h3><pre style="white-space:pre-wrap;font-size:12px;color:var(--text-dim);max-height:400px;overflow:auto;">' + esc(raw) + '</pre></div>';
                return;
            }
        } else {
            data = raw;
        }

        var html = '';
        html += renderExecutiveSummary(data);
        html += renderQuickWins(data.quick_wins);
        html += renderLiveAlerts(data.live_creative_alerts);
        html += renderPerformersGrid(data);
        html += renderInsightsSection('Video Insights', 'sec_video', data.video_insights, '&#9654;');
        html += renderInsightsSection('Static Insights', 'sec_static', data.static_insights, '&#9632;');
        html += renderFunnelAnalysis(data);
        html += renderLTVInsights(data);

        container.innerHTML = html;
    }

    /* ─── init ─── */
    function init() {
        var container = document.getElementById('intelligenceView');
        if (!container) return;

        container.innerHTML =
            '<div class="ci-panel">' +
                '<div class="ci-header">' +
                    '<h2>Creative Intelligence</h2>' +
                    '<p style="color:var(--text-dim);font-size:13px;margin-bottom:16px;">AI-powered analysis of what makes your creatives succeed or fail</p>' +
                    '<div style="display:flex;gap:10px;align-items:center;">' +
                        '<button id="ciRunAnalysis" class="btn-ci-primary">&#9889; Run Analysis</button>' +
                        '<button id="ciRegenerate" class="btn-ci-primary" style="display:none;background:var(--border);color:var(--text);">&#8635; Regenerate</button>' +
                        '<span id="ciAnalysisStatus" style="font-size:12px;color:var(--text-dim);"></span>' +
                    '</div>' +
                '</div>' +
                '<div id="ciResultsContainer"></div>' +
            '</div>';

        var runBtn = document.getElementById('ciRunAnalysis');
        var regenBtn = document.getElementById('ciRegenerate');
        var statusEl = document.getElementById('ciAnalysisStatus');
        var resultsContainer = document.getElementById('ciResultsContainer');
        var lastPortalSignature = '';

        function portalSignature(ctx) {
            ctx = ctx || (window.getPortalAssistantContext ? window.getPortalAssistantContext() : null) || {};
            var range = ctx.dateRange || {};
            var diag = ctx.diagnostics || {};
            return [
                ctx.app || 'meta',
                ctx.view || 'intelligence',
                range.since || '',
                range.until || '',
                range.label || '',
                diag.source || '',
                diag.matchedKeys || 0,
                diag.unmatchedKeys || 0
            ].join('::');
        }

        function runAnalysis(forceRefresh) {
            // Check data
            var check = window.checkDataSufficiency ? window.checkDataSufficiency() : null;
            if (check && !check.sufficient) {
                statusEl.textContent = check.reason;
                statusEl.style.color = 'var(--orange)';
                return;
            }

            var ctx = window.prepareAIContext ? window.prepareAIContext() : null;
            if (!ctx) {
                statusEl.textContent = 'No data loaded yet. Wait for data to finish loading, then try again.';
                statusEl.style.color = 'var(--orange)';
                return;
            }

            var userPrompt = buildIntelligencePrompt(ctx);
            statusEl.textContent = 'Analyzing ' + ctx.data_quality.with_spend_data + ' creatives...';
            statusEl.style.color = 'var(--text-dim)';
            runBtn.disabled = true;
            runBtn.style.opacity = '0.5';
            regenBtn.style.display = 'none';

            window.callAI(
                SYSTEM_PROMPT,
                userPrompt,
                window.getAIViewCacheKey ? window.getAIViewCacheKey('intelligence_v2') : 'intelligence_v2',
                function(parsed, el) {
                    renderIntelligence(parsed, el || resultsContainer);
                    runBtn.disabled = false;
                    runBtn.style.opacity = '1';
                    regenBtn.style.display = '';
                    statusEl.textContent = 'Analysis complete!';
                    statusEl.style.color = 'var(--green)';
                },
                resultsContainer,
                !!forceRefresh
            );
        }

        window.ciRunAnalysis = runAnalysis;

        runBtn.addEventListener('click', function() { runAnalysis(false); });
        regenBtn.addEventListener('click', function() {
            if (window.AI_CACHE) window.AI_CACHE.clear(window.getAIViewCacheKey ? window.getAIViewCacheKey('intelligence_v2') : 'intelligence_v2');
            runAnalysis(true);
        });

        window.addEventListener('portal-data-updated', function() {
            var view = document.getElementById('intelligenceView');
            var ctx = window.getPortalAssistantContext ? window.getPortalAssistantContext() : null;
            var signature = portalSignature(ctx);
            if (signature === lastPortalSignature) return;
            lastPortalSignature = signature;
            if (view && view.classList.contains('active')) {
                if (window.AI_CACHE) window.AI_CACHE.clear(window.getAIViewCacheKey ? window.getAIViewCacheKey('intelligence_v2') : 'intelligence_v2');
                runAnalysis(true);
            }
        });

        // Auto-render from cache if available
        if (window.AI_CACHE) {
            var cachedKey = window.getAIViewCacheKey ? window.getAIViewCacheKey('intelligence_v2') : 'intelligence_v2';
            var cached = window.AI_CACHE.get(cachedKey);
            if (cached) {
                renderIntelligence(cached, resultsContainer);
                regenBtn.style.display = '';
                var cachedAt = window.AI_CACHE.timestamps ? window.AI_CACHE.timestamps[cachedKey] : null;
                statusEl.textContent = cachedAt
                    ? 'Showing cached result from ' + new Date(cachedAt).toLocaleString('en-IN')
                    : 'Showing cached result';
                statusEl.style.color = 'var(--text-dim)';
            }
        }
    }

    window.ciIntelligenceInit = init;

    // Self-bootstrap
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
