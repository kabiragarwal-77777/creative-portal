// =============================================================================
// AI Cache + Freshness Manager
// Prevents stale/empty AI calls, caches results with localStorage fallback
// =============================================================================

(function() {
    'use strict';

    var AI_CACHE = {
        intelligence: null,
        ltv: {},
        recommendations: null,
        timestamps: {},

        isStale: function(key, maxAgeMinutes) {
            maxAgeMinutes = maxAgeMinutes || 60;
            var ts = this.timestamps[key];
            if (!ts) return true;
            return (Date.now() - ts) > (maxAgeMinutes * 60 * 1000);
        },

        set: function(key, data) {
            if (key === 'ltv') return; // ltv uses sub-keys
            this[key] = data;
            this.timestamps[key] = Date.now();
            try {
                localStorage.setItem('ai_cache_' + key, JSON.stringify({ data: data, ts: Date.now() }));
            } catch (e) { /* quota exceeded */ }
        },

        setLtv: function(creativeName, data) {
            this.ltv[creativeName] = data;
            this.timestamps['ltv_' + creativeName] = Date.now();
            try {
                localStorage.setItem('ai_cache_ltv_' + creativeName, JSON.stringify({ data: data, ts: Date.now() }));
            } catch (e) { /* quota exceeded */ }
        },

        get: function(key) {
            if (this[key]) return this[key];
            try {
                var stored = localStorage.getItem('ai_cache_' + key);
                if (stored) {
                    var parsed = JSON.parse(stored);
                    // Max 4 hours from localStorage
                    if (Date.now() - parsed.ts < 4 * 60 * 60 * 1000) {
                        this[key] = parsed.data;
                        this.timestamps[key] = parsed.ts;
                        return parsed.data;
                    }
                }
            } catch (e) { /* parse error */ }
            return null;
        },

        getLtv: function(creativeName) {
            if (this.ltv[creativeName]) return this.ltv[creativeName];
            try {
                var stored = localStorage.getItem('ai_cache_ltv_' + creativeName);
                if (stored) {
                    var parsed = JSON.parse(stored);
                    if (Date.now() - parsed.ts < 4 * 60 * 60 * 1000) {
                        this.ltv[creativeName] = parsed.data;
                        this.timestamps['ltv_' + creativeName] = parsed.ts;
                        return parsed.data;
                    }
                }
            } catch (e) { /* parse error */ }
            return null;
        },

        clear: function(key) {
            if (key) {
                this[key] = null;
                delete this.timestamps[key];
                try { localStorage.removeItem('ai_cache_' + key); } catch (e) {}
            } else {
                var self = this;
                ['intelligence', 'recommendations'].forEach(function(k) { self.clear(k); });
                Object.keys(self.ltv).forEach(function(k) {
                    delete self.ltv[k];
                    delete self.timestamps['ltv_' + k];
                    try { localStorage.removeItem('ai_cache_ltv_' + k); } catch (e) {}
                });
            }
        }
    };

    // Data sufficiency check — never call AI with empty data
    function checkDataSufficiency() {
        var ctx = window.prepareAIContext ? window.prepareAIContext() : null;
        if (!ctx) return { sufficient: false, reason: 'No data loaded yet. Wait for data to finish loading.' };
        if (ctx.data_quality.with_spend_data < 3)
            return { sufficient: false, reason: 'Need at least 3 creatives with spend data (' + ctx.data_quality.with_spend_data + ' found)' };
        if (ctx.data_quality.with_d6_data < 2)
            return { sufficient: false, reason: 'Need D6 conversion data on at least 2 creatives (' + ctx.data_quality.with_d6_data + ' found)' };
        return { sufficient: true, creative_count: ctx.data_quality.with_spend_data };
    }

    // Generic AI caller with loading states, error handling, caching
    async function callAI(systemPrompt, userPrompt, cacheKey, renderFn, containerEl, forceRefresh) {
        // Check data sufficiency
        var check = checkDataSufficiency();
        if (!check.sufficient) {
            if (containerEl) containerEl.innerHTML =
                '<div class="ai-error">' +
                    '<div class="ai-error-title">Cannot generate insights</div>' +
                    '<div class="ai-error-msg">' + escapeHtml(check.reason) + '</div>' +
                '</div>';
            return;
        }

        // Check cache
        if (!forceRefresh) {
            var cached = AI_CACHE.get(cacheKey);
            if (cached) {
                renderFn(cached, containerEl);
                showCacheNotice(containerEl, AI_CACHE.timestamps[cacheKey]);
                return;
            }
        }

        // Show loading state
        var dataCount = (window.allData || []).length;
        if (containerEl) containerEl.innerHTML =
            '<div class="ai-loading">' +
                '<div class="ai-loading-spinner"></div>' +
                '<div class="ai-loading-text">Analyzing ' + dataCount + ' creatives...</div>' +
                '<div class="ai-loading-sub">This takes 15-30 seconds. Results are cached for 4 hours.</div>' +
            '</div>';

        try {
            var response = await fetch('api/ai/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system: systemPrompt,
                    prompt: userPrompt,
                    max_tokens: 8000
                }),
                signal: AbortSignal.timeout(90000)
            });

            if (!response.ok) throw new Error('API error: ' + response.status);

            var result = await response.json();
            if (!result.success) throw new Error(result.error || 'Unknown API error');

            var content = result.content || '';
            var parsed;

            try {
                // Strip markdown code blocks if present
                var clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                parsed = JSON.parse(clean);
            } catch (parseErr) {
                throw new Error('AI returned invalid JSON. Raw start: ' + content.substring(0, 300));
            }

            AI_CACHE.set(cacheKey, parsed);
            renderFn(parsed, containerEl);

        } catch (err) {
            if (containerEl) containerEl.innerHTML =
                '<div class="ai-error">' +
                    '<div class="ai-error-title">Analysis failed</div>' +
                    '<div class="ai-error-msg">' + escapeHtml(err.message) + '</div>' +
                    '<button onclick="window.aiRegenerate && window.aiRegenerate(\'' + cacheKey + '\')" class="btn-ci-primary" style="margin-top:12px;">Try Again</button>' +
                    (AI_CACHE.get(cacheKey) ?
                        '<button onclick="window.aiShowCached && window.aiShowCached(\'' + cacheKey + '\')" class="btn-ci-primary" style="margin-top:12px;margin-left:8px;background:var(--border);">Show Last Result</button>' : '') +
                '</div>';
            console.error('AI call failed:', err);
        }
    }

    function showCacheNotice(containerEl, timestamp) {
        if (!containerEl || !timestamp) return;
        var ago = Math.round((Date.now() - timestamp) / 60000);
        var text = ago < 1 ? 'Just now' : ago + ' min ago';
        var notice = document.createElement('div');
        notice.className = 'ai-cache-notice';
        notice.textContent = 'Cached result from ' + text + ' — click Regenerate for fresh analysis';
        containerEl.insertBefore(notice, containerEl.firstChild);
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    window.AI_CACHE = AI_CACHE;
    window.checkDataSufficiency = checkDataSufficiency;
    window.callAI = callAI;
})();
