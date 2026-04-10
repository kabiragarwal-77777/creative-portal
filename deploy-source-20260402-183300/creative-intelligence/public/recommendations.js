(function() {
    'use strict';

    var CACHE_KEY = 'ci_recommendations_v2';

    var SYSTEM_PROMPT =
        'You are Univest\'s Creative Director with full access to Meta performance data.\n' +
        'You generate specific creative briefs grounded in what has actually worked.\n\n' +
        'RULES FOR GOOD RECOMMENDATIONS:\n' +
        '1. Every recommendation must cite which top-performing creative it\'s based on\n' +
        '2. Scripts must be word-for-word, not templates — actual dialogue and copy\n' +
        '3. Budget recommendations must cite the test threshold (min spend to validate)\n' +
        '4. Revamp suggestions change ONE specific element, not everything\n' +
        '5. Never recommend a format/hook that appears in the bottom performers\n' +
        '6. For video: specify exact duration (6s, 15s, 30s) based on what works in Univest\'s data\n' +
        '7. For static: specify exact aspect ratio based on top-performing statics';

    function buildRecommendationsPrompt(ctx) {
        var topByHook = ctx.top_20_by_d6_roas.filter(function(d) { return d.type === 'Video' && d.hook_rate_pct; })
            .sort(function(a, b) { return parseFloat(b.hook_rate_pct) - parseFloat(a.hook_rate_pct); }).slice(0, 5);
        var topByD6Quality = ctx.top_20_by_d6_roas
            .filter(function(d) { return d.d0trial_to_d6_pct && parseFloat(d.d0trial_to_d6_pct) > 0; }).slice(0, 5);
        var liveUnderperformers = ctx.live_creatives
            .filter(function(d) { return parseFloat(d.d6_roas_pct) < 20 && d.spend > 20000; });

        return 'Generate creative recommendations for Univest Meta campaigns.\n\n' +
            'TOP PERFORMERS (base all new ideas on these):\n' +
            JSON.stringify(ctx.top_20_by_d6_roas.slice(0, 10), null, 2) + '\n\n' +
            'BEST VIDEO HOOKS (by hook rate):\n' +
            JSON.stringify(topByHook, null, 2) + '\n\n' +
            'BEST D0TRIAL-TO-D6 CONVERTERS:\n' +
            JSON.stringify(topByD6Quality, null, 2) + '\n\n' +
            'PORTFOLIO BENCHMARKS:\n' +
            JSON.stringify(ctx.univest_context.current_benchmarks, null, 2) + '\n\n' +
            'LIVE UNDERPERFORMERS (need revamp or pause):\n' +
            JSON.stringify(liveUnderperformers, null, 2) + '\n\n' +
            'ACTUAL LTV DATA:\nRevenue per signup: \u20b9' + Math.round(ctx.ltv_data.avg_revenue_per_signup || 0) + '\n' +
            (ctx.ltv_data.top_by_overall_revenue ?
                'Best LTV creatives: ' + JSON.stringify(ctx.ltv_data.top_by_overall_revenue.slice(0, 3)) : '') + '\n\n' +
            'Generate this exact JSON:\n' +
            '{\n' +
            '  "new_creative_briefs": [\n' +
            '    {\n' +
            '      "brief_id": "BRIEF-001",\n' +
            '      "title": "descriptive name",\n' +
            '      "format": "Video-15s | Video-30s | Static-1x1 | Static-4x5 | Static-9x16",\n' +
            '      "based_on": "specific top performer name and its D6 ROAS",\n' +
            '      "hypothesis": "specific, testable hypothesis",\n' +
            '      "hook": {\n' +
            '        "opening_line": "EXACT word-for-word first line",\n' +
            '        "visual": "what appears on screen in first 3 seconds",\n' +
            '        "emotion_target": "fear / aspiration / trust / curiosity / urgency",\n' +
            '        "why_this_hook_works": "cite which top performer used similar hook"\n' +
            '      },\n' +
            '      "full_script_or_copy": "For VIDEO: complete word-for-word script with timestamps. For STATIC: Headline / Subheadline / Body / CTA button text.",\n' +
            '      "visual_direction": {\n' +
            '        "background": "specific description",\n' +
            '        "text_overlays": ["exact text 1", "exact text 2"],\n' +
            '        "color_notes": "based on top performer"\n' +
            '      },\n' +
            '      "test_parameters": {\n' +
            '        "budget": "\u20b9X for 300+ installs",\n' +
            '        "audience": "specific Meta audience",\n' +
            '        "success_threshold": "D6 ROAS > X% after \u20b9Y spend",\n' +
            '        "days_to_evaluate": "8 days for full D6 window"\n' +
            '      },\n' +
            '      "predicted_performance": {\n' +
            '        "d6_roas_range": "X-Y%",\n' +
            '        "confidence": "HIGH/MEDIUM/LOW",\n' +
            '        "key_assumption": "what this prediction assumes"\n' +
            '      }\n' +
            '    }\n' +
            '  ],\n' +
            '  "revamp_suggestions": [\n' +
            '    {\n' +
            '      "creative_name": "exact name",\n' +
            '      "current_d6_roas": "X%",\n' +
            '      "spend_at_risk": "\u20b9X",\n' +
            '      "diagnosis": "where in the funnel it fails",\n' +
            '      "recommended_change": "change ONE thing only",\n' +
            '      "new_version": "exact replacement text",\n' +
            '      "why_this_fix": "cite which top performer uses this approach",\n' +
            '      "expected_improvement": "estimated D6 ROAS change",\n' +
            '      "decision": "PAUSE NOW / TEST VARIATION / KILL"\n' +
            '    }\n' +
            '  ],\n' +
            '  "budget_reallocation": {\n' +
            '    "immediate_actions": "specific \u20b9 moves",\n' +
            '    "reallocate_from": ["creative names with current daily spend"],\n' +
            '    "reallocate_to": ["creative names with recommended new spend"],\n' +
            '    "expected_portfolio_roas_improvement": "estimated overall D6 ROAS change"\n' +
            '  }\n' +
            '}\n\nReturn valid JSON only. Generate 3 new_creative_briefs.';
    }

    /* ---- Init ---- */

    function init() {
        var container = document.getElementById('recommendationsView');
        if (!container) return;
        renderShell(container);
        attachEvents(container);
        loadFromCache(container);
    }

    /* ---- Shell ---- */

    function renderShell(container) {
        container.innerHTML =
            '<div style="padding:0">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">' +
                    '<div>' +
                        '<h2 style="margin:0 0 4px;font-size:20px;color:var(--text,#e4e4e7)">Creative Recommendations</h2>' +
                        '<p style="margin:0;color:var(--text-dim,#71717a);font-size:13px">AI-generated briefs, revamps & budget moves grounded in real performance data</p>' +
                    '</div>' +
                    '<div style="display:flex;align-items:center;gap:12px">' +
                        '<span id="ciRecStatus" style="color:var(--text-dim,#71717a);font-size:12px"></span>' +
                        '<button id="ciRecRegenerate" style="' +
                            'background:var(--accent,#6366f1);color:#fff;border:none;padding:10px 22px;' +
                            'border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;' +
                            'transition:opacity .2s;white-space:nowrap' +
                        '">Generate Recommendations</button>' +
                    '</div>' +
                '</div>' +
                '<div id="ciRecLoading" style="display:none;text-align:center;padding:60px 20px">' +
                    '<div style="width:40px;height:40px;border:3px solid var(--border,#1e1e2e);' +
                        'border-top-color:var(--accent,#6366f1);border-radius:50%;' +
                        'animation:ciRecSpin .8s linear infinite;margin:0 auto 20px"></div>' +
                    '<p style="color:var(--text,#e4e4e7);font-size:15px;margin:0 0 6px">Generating creative recommendations...</p>' +
                    '<p style="color:var(--text-dim,#71717a);font-size:13px;margin:0">AI is analyzing top performers and crafting briefs</p>' +
                '</div>' +
                '<div id="ciRecContent"></div>' +
            '</div>' +
            '<style>@keyframes ciRecSpin{to{transform:rotate(360deg)}}</style>';
    }

    /* ---- Events ---- */

    function attachEvents(container) {
        var btn = document.getElementById('ciRecRegenerate');
        if (btn) {
            btn.addEventListener('click', function() { runGenerate(true); });
        }
        container.addEventListener('click', function(e) {
            // Collapse toggle
            var toggle = e.target.closest('[data-ci-toggle]');
            if (toggle) {
                var target = document.getElementById(toggle.getAttribute('data-ci-toggle'));
                if (target) {
                    var open = target.style.display !== 'none';
                    target.style.display = open ? 'none' : 'block';
                    var arrow = toggle.querySelector('.ci-arrow');
                    if (arrow) arrow.textContent = open ? '\u25B6' : '\u25BC';
                }
                return;
            }
            // Copy script
            var copyBtn = e.target.closest('[data-ci-copy]');
            if (copyBtn) {
                var text = copyBtn.getAttribute('data-ci-copy');
                navigator.clipboard.writeText(text).then(function() {
                    var orig = copyBtn.textContent;
                    copyBtn.textContent = 'Copied!';
                    copyBtn.style.borderColor = 'var(--green,#22c55e)';
                    copyBtn.style.color = 'var(--green,#22c55e)';
                    setTimeout(function() {
                        copyBtn.textContent = orig;
                        copyBtn.style.borderColor = '';
                        copyBtn.style.color = '';
                    }, 1500);
                });
            }
        });
    }

    /* ---- Generate ---- */

    function runGenerate(forceRefresh) {
        var statusEl = document.getElementById('ciRecStatus');
        var contentEl = document.getElementById('ciRecContent');
        var loadingEl = document.getElementById('ciRecLoading');

        if (!window.checkDataSufficiency || !window.checkDataSufficiency()) {
            if (statusEl) {
                statusEl.textContent = 'Not enough data loaded yet';
                statusEl.style.color = 'var(--orange,#f59e0b)';
            }
            return;
        }

        var ctx = window.prepareAIContext();
        if (!ctx) {
            if (statusEl) {
                statusEl.textContent = 'Could not prepare AI context';
                statusEl.style.color = 'var(--red,#ef4444)';
            }
            return;
        }

        var userPrompt = buildRecommendationsPrompt(ctx);

        window.callAI(
            SYSTEM_PROMPT,
            userPrompt,
            CACHE_KEY,
            function(parsed) { renderResults(parsed, contentEl); },
            contentEl,
            forceRefresh
        );
    }

    /* ---- Load from cache ---- */

    function loadFromCache(container) {
        if (window.AI_CACHE && window.AI_CACHE[CACHE_KEY]) {
            var contentEl = document.getElementById('ciRecContent');
            try {
                renderResults(window.AI_CACHE[CACHE_KEY], contentEl);
                var statusEl = document.getElementById('ciRecStatus');
                if (statusEl) {
                    statusEl.textContent = 'Loaded from cache';
                    statusEl.style.color = 'var(--text-dim,#71717a)';
                }
            } catch (e) { /* ignore */ }
        }
    }

    /* ---- Render Results ---- */

    function renderResults(data, container) {
        if (!data || !container) return;
        var html = '';

        // 1) Budget Reallocation (first, prominent)
        html += renderBudgetReallocation(data.budget_reallocation);

        // 2) Revamp Suggestions
        html += renderRevampSuggestions(data.revamp_suggestions || []);

        // 3) New Creative Briefs
        html += renderCreativeBriefs(data.new_creative_briefs || []);

        container.innerHTML = html;
    }

    /* ---- Budget Reallocation ---- */

    function renderBudgetReallocation(budget) {
        if (!budget) return '';
        var id = 'ciRecBudgetBody';
        return collapsibleSection('Budget Reallocation', id, true,
            '<div style="' + cardStyle() + 'border-left:4px solid var(--accent,#6366f1)">' +
                '<div style="font-size:15px;font-weight:600;color:var(--text,#e4e4e7);margin-bottom:14px">' +
                    esc(budget.immediate_actions || 'No immediate actions') +
                '</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">' +
                    '<div>' +
                        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--red,#ef4444);margin-bottom:8px;font-weight:600">Reduce Spend On</div>' +
                        renderBudgetList(budget.reallocate_from || [], 'var(--red,#ef4444)') +
                    '</div>' +
                    '<div>' +
                        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--green,#22c55e);margin-bottom:8px;font-weight:600">Increase Spend On</div>' +
                        renderBudgetList(budget.reallocate_to || [], 'var(--green,#22c55e)') +
                    '</div>' +
                '</div>' +
                (budget.expected_portfolio_roas_improvement ?
                    '<div style="background:rgba(99,102,241,0.1);border:1px solid var(--accent,#6366f1);border-radius:8px;padding:12px 16px;font-size:13px;color:var(--accent,#6366f1);font-weight:600">' +
                        'Expected Impact: ' + esc(budget.expected_portfolio_roas_improvement) +
                    '</div>' : '') +
            '</div>'
        );
    }

    function renderBudgetList(items, color) {
        if (!items.length) return '<span style="color:var(--text-dim,#71717a);font-size:13px">None</span>';
        return items.map(function(item) {
            return '<div style="padding:6px 0;font-size:13px;color:var(--text,#e4e4e7);border-bottom:1px solid var(--border,#1e1e2e);display:flex;align-items:center;gap:8px">' +
                '<span style="width:6px;height:6px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>' +
                esc(typeof item === 'string' ? item : JSON.stringify(item)) +
            '</div>';
        }).join('');
    }

    /* ---- Revamp Suggestions ---- */

    function renderRevampSuggestions(revamps) {
        if (!revamps.length) return '';
        var id = 'ciRecRevampBody';
        var cards = revamps.map(function(r) {
            var decision = (r.decision || '').toUpperCase().trim();
            var badgeColor, badgeBg;
            if (decision.indexOf('PAUSE') !== -1) {
                badgeColor = '#fff'; badgeBg = 'var(--red,#ef4444)';
            } else if (decision.indexOf('KILL') !== -1) {
                badgeColor = '#fff'; badgeBg = 'var(--red,#ef4444)';
            } else if (decision.indexOf('TEST') !== -1) {
                badgeColor = '#000'; badgeBg = 'var(--orange,#f59e0b)';
            } else {
                badgeColor = '#fff'; badgeBg = 'var(--text-dim,#71717a)';
            }

            return '<div style="' + cardStyle() + 'margin-bottom:12px">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap;gap:8px">' +
                    '<div style="font-size:14px;font-weight:600;color:var(--text,#e4e4e7);flex:1;min-width:200px">' + esc(r.creative_name) + '</div>' +
                    '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">' +
                        (r.current_d6_roas ? '<span style="font-size:12px;color:var(--text-dim,#71717a)">D6: ' + esc(r.current_d6_roas) + '</span>' : '') +
                        '<span style="background:' + badgeBg + ';color:' + badgeColor + ';padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap">' + esc(decision || 'REVIEW') + '</span>' +
                    '</div>' +
                '</div>' +
                (r.spend_at_risk ? '<div style="font-size:12px;color:var(--red,#ef4444);margin-bottom:8px">Spend at risk: ' + esc(r.spend_at_risk) + '</div>' : '') +
                (r.diagnosis ? '<div style="font-size:13px;color:var(--text,#e4e4e7);margin-bottom:10px"><strong style="color:var(--text-dim,#71717a)">Diagnosis:</strong> ' + esc(r.diagnosis) + '</div>' : '') +
                (r.recommended_change ? '<div style="font-size:13px;color:var(--text,#e4e4e7);margin-bottom:10px"><strong style="color:var(--text-dim,#71717a)">Change:</strong> ' + esc(r.recommended_change) + '</div>' : '') +
                (r.new_version ? '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border,#1e1e2e);border-radius:6px;padding:10px 14px;font-size:13px;color:var(--text,#e4e4e7);margin-bottom:10px;font-family:monospace;white-space:pre-wrap">' + esc(r.new_version) + '</div>' : '') +
                (r.why_this_fix ? '<div style="font-size:12px;color:var(--text-dim,#71717a);font-style:italic;margin-bottom:8px">' + esc(r.why_this_fix) + '</div>' : '') +
                (r.expected_improvement ? '<div style="font-size:13px;color:var(--green,#22c55e);font-weight:500">' + esc(r.expected_improvement) + '</div>' : '') +
            '</div>';
        }).join('');

        return collapsibleSection('Revamp Suggestions (' + revamps.length + ')', id, true, cards);
    }

    /* ---- Creative Briefs ---- */

    function renderCreativeBriefs(briefs) {
        if (!briefs.length) return '';
        var id = 'ciRecBriefsBody';
        var cards = briefs.map(function(b) {
            var isVideo = (b.format || '').toLowerCase().indexOf('video') !== -1;
            var formatColor = isVideo ? 'var(--accent,#6366f1)' : 'var(--green,#22c55e)';

            var hook = b.hook || {};
            var visual = b.visual_direction || {};
            var test = b.test_parameters || {};
            var perf = b.predicted_performance || {};
            var confColor = 'var(--text-dim,#71717a)';
            var conf = (perf.confidence || '').toUpperCase();
            if (conf === 'HIGH') confColor = 'var(--green,#22c55e)';
            else if (conf === 'MEDIUM') confColor = 'var(--orange,#f59e0b)';
            else if (conf === 'LOW') confColor = 'var(--red,#ef4444)';

            var scriptText = b.full_script_or_copy || '';

            return '<div style="' + cardStyle() + 'margin-bottom:16px">' +
                // Header row: ID badge, format badge, title
                '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">' +
                    '<span style="background:var(--border,#1e1e2e);color:var(--text-dim,#71717a);padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;font-family:monospace">' + esc(b.brief_id || 'BRIEF') + '</span>' +
                    '<span style="background:' + formatColor + ';color:#fff;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700">' + esc(b.format || 'Unknown') + '</span>' +
                    '<span style="font-size:15px;font-weight:600;color:var(--text,#e4e4e7)">' + esc(b.title || 'Untitled Brief') + '</span>' +
                '</div>' +

                // Based on
                (b.based_on ?
                    '<div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px">' +
                        '<span style="color:var(--text-dim,#71717a);font-weight:600">Based on:</span> ' +
                        '<span style="color:var(--accent,#6366f1)">' + esc(b.based_on) + '</span>' +
                    '</div>' : '') +

                // Hypothesis
                (b.hypothesis ?
                    '<div style="font-size:13px;color:var(--text,#e4e4e7);margin-bottom:14px">' +
                        '<strong style="color:var(--text-dim,#71717a)">Hypothesis:</strong> ' + esc(b.hypothesis) +
                    '</div>' : '') +

                // Hook section
                (hook.opening_line ?
                    '<div style="margin-bottom:14px">' +
                        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim,#71717a);margin-bottom:8px;font-weight:600">Hook</div>' +
                        '<div style="font-size:15px;font-weight:600;color:var(--accent,#6366f1);margin-bottom:6px">\u201C' + esc(hook.opening_line) + '\u201D</div>' +
                        (hook.visual ? '<div style="font-size:12px;color:var(--text,#e4e4e7);margin-bottom:4px"><strong>Visual:</strong> ' + esc(hook.visual) + '</div>' : '') +
                        (hook.emotion_target ? '<div style="font-size:12px;color:var(--text-dim,#71717a)"><strong>Emotion:</strong> ' + esc(hook.emotion_target) + '</div>' : '') +
                        (hook.why_this_hook_works ? '<div style="font-size:12px;color:var(--text-dim,#71717a);font-style:italic;margin-top:4px">' + esc(hook.why_this_hook_works) + '</div>' : '') +
                    '</div>' : '') +

                // Full script/copy
                (scriptText ?
                    '<div style="margin-bottom:14px">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
                            '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim,#71717a);font-weight:600">' + (isVideo ? 'Script' : 'Copy') + '</div>' +
                            '<button data-ci-copy="' + escAttr(scriptText) + '" style="' +
                                'background:transparent;border:1px solid var(--border,#1e1e2e);color:var(--text-dim,#71717a);' +
                                'padding:4px 12px;border-radius:6px;font-size:11px;cursor:pointer;transition:all .2s' +
                            '">Copy ' + (isVideo ? 'Script' : 'Copy') + '</button>' +
                        '</div>' +
                        '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border,#1e1e2e);border-radius:8px;padding:14px 16px;font-size:13px;color:var(--text,#e4e4e7);font-family:monospace;white-space:pre-wrap;line-height:1.6;max-height:300px;overflow-y:auto">' +
                            esc(scriptText) +
                        '</div>' +
                    '</div>' : '') +

                // Visual direction
                (visual.background || (visual.text_overlays && visual.text_overlays.length) || visual.color_notes ?
                    '<div style="margin-bottom:14px">' +
                        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim,#71717a);margin-bottom:8px;font-weight:600">Visual Direction</div>' +
                        (visual.background ? '<div style="font-size:12px;color:var(--text,#e4e4e7);margin-bottom:4px"><strong>Background:</strong> ' + esc(visual.background) + '</div>' : '') +
                        (visual.text_overlays && visual.text_overlays.length ?
                            '<div style="font-size:12px;color:var(--text,#e4e4e7);margin-bottom:4px"><strong>Overlays:</strong> ' +
                                visual.text_overlays.map(function(t) { return '\u201C' + esc(t) + '\u201D'; }).join(', ') +
                            '</div>' : '') +
                        (visual.color_notes ? '<div style="font-size:12px;color:var(--text-dim,#71717a)">' + esc(visual.color_notes) + '</div>' : '') +
                    '</div>' : '') +

                // Test parameters grid
                (test.budget || test.audience || test.success_threshold || test.days_to_evaluate ?
                    '<div style="margin-bottom:14px">' +
                        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim,#71717a);margin-bottom:8px;font-weight:600">Test Parameters</div>' +
                        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
                            testParamCell('Budget', test.budget) +
                            testParamCell('Audience', test.audience) +
                            testParamCell('Success Threshold', test.success_threshold) +
                            testParamCell('Eval Window', test.days_to_evaluate) +
                        '</div>' +
                    '</div>' : '') +

                // Predicted performance
                (perf.d6_roas_range || perf.confidence ?
                    '<div style="display:flex;align-items:center;gap:12px;padding-top:12px;border-top:1px solid var(--border,#1e1e2e);flex-wrap:wrap">' +
                        (perf.d6_roas_range ? '<div style="font-size:13px;color:var(--text,#e4e4e7)"><strong>Predicted D6 ROAS:</strong> ' + esc(perf.d6_roas_range) + '</div>' : '') +
                        (perf.confidence ? '<span style="background:' + confColor + ';color:#fff;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:700">' + esc(conf) + '</span>' : '') +
                        (perf.key_assumption ? '<div style="font-size:12px;color:var(--text-dim,#71717a);font-style:italic">' + esc(perf.key_assumption) + '</div>' : '') +
                    '</div>' : '') +
            '</div>';
        }).join('');

        return collapsibleSection('New Creative Briefs (' + briefs.length + ')', id, true, cards);
    }

    function testParamCell(label, value) {
        if (!value) return '';
        return '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border,#1e1e2e);border-radius:6px;padding:8px 10px">' +
            '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-dim,#71717a);margin-bottom:3px">' + esc(label) + '</div>' +
            '<div style="font-size:12px;color:var(--text,#e4e4e7)">' + esc(value) + '</div>' +
        '</div>';
    }

    /* ---- Collapsible Section ---- */

    function collapsibleSection(title, bodyId, openByDefault, bodyHtml) {
        return '<div style="margin-bottom:24px">' +
            '<div data-ci-toggle="' + bodyId + '" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 0;user-select:none">' +
                '<span class="ci-arrow" style="font-size:10px;color:var(--text-dim,#71717a);transition:transform .2s">' + (openByDefault ? '\u25BC' : '\u25B6') + '</span>' +
                '<h3 style="margin:0;font-size:16px;color:var(--text,#e4e4e7)">' + esc(title) + '</h3>' +
            '</div>' +
            '<div id="' + bodyId + '" style="display:' + (openByDefault ? 'block' : 'none') + '">' +
                bodyHtml +
            '</div>' +
        '</div>';
    }

    /* ---- Utilities ---- */

    function cardStyle() {
        return 'background:var(--bg-card,#12121a);border:1px solid var(--border,#1e1e2e);border-radius:10px;padding:20px;';
    }

    function esc(s) {
        if (s == null) return '';
        var d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function escAttr(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ---- Export ---- */

    window.ciRecommendationsInit = init;

    // Self-bootstrap
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
