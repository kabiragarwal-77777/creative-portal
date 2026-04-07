(function() {
    'use strict';

    var GC = window.GC || {};
    var _briefs = [];
    var _currentType = 'all';
    var _loaded = false;

    document.addEventListener('gc-tab-activated', function(e) {
        if (e.detail && e.detail.tab === 'recommendations') {
            loadRecommendations();
        }
    });

    function loadRecommendations() {
        var container = document.getElementById('gcRecommendationsView');
        if (!container) return;

        if (!_loaded) {
            _loaded = true;
            container.innerHTML = buildShell();
            bindEvents();
        }

        fetchBriefs();
    }

    function buildShell() {
        return '' +
        '<div class="gc-panel">' +
            // Header
            '<div class="gc-header">' +
                '<h2>Google Ads Creative Recommendations</h2>' +
                '<p>AI-generated creative briefs based on top-performing Google Ads patterns</p>' +
            '</div>' +

            // Controls
            '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px;">' +
                // Pill toggle
                '<div class="gc-pill-toggle" id="gcRecTypeToggle">' +
                    '<button class="gc-pill-btn active" data-brief-type="all">All Briefs</button>' +
                    '<button class="gc-pill-btn" data-brief-type="RSA">RSA Briefs</button>' +
                    '<button class="gc-pill-btn" data-brief-type="Video">Video Briefs</button>' +
                    '<button class="gc-pill-btn" data-brief-type="PMax">PMax Briefs</button>' +
                '</div>' +
                // Refresh
                '<button id="gcRecRefreshBtn" class="gc-btn-teal">&#10024; Regenerate Briefs</button>' +
            '</div>' +

            // Status
            '<div id="gcRecStatus" style="display:none;"></div>' +

            // Loading
            '<div id="gcRecLoading" style="display:none;">' +
                '<div class="gc-loading">' +
                    '<div class="gc-spinner"></div>' +
                    '<div class="gc-loading-text">Loading creative briefs...</div>' +
                '</div>' +
            '</div>' +

            // Briefs Grid
            '<div id="gcRecBriefs" class="gc-briefs-grid"></div>' +
        '</div>';
    }

    function bindEvents() {
        // Type toggle
        var toggle = document.getElementById('gcRecTypeToggle');
        if (toggle) {
            toggle.addEventListener('click', function(e) {
                var btn = e.target.closest('.gc-pill-btn');
                if (!btn) return;
                var type = btn.getAttribute('data-brief-type');
                if (!type) return;
                _currentType = type;
                toggle.querySelectorAll('.gc-pill-btn').forEach(function(b) {
                    b.classList.toggle('active', b === btn);
                });
                renderBriefs();
            });
        }

        // Regenerate
        var refreshBtn = document.getElementById('gcRecRefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', handleRegenerate);
        }
    }

    function fetchBriefs() {
        showLoading(true);
        hideStatus();

        fetch('/creative-portal/api/gc/recommendations/briefs?type=all')
        .then(function(r) { return r.json(); })
        .then(function(result) {
            showLoading(false);
            if (result.success && result.data) {
                _briefs = Array.isArray(result.data) ? result.data : (result.data.briefs || []);
                renderBriefs();
            } else {
                showBriefsError(result.error || 'Failed to load recommendations');
            }
        })
        .catch(function(err) {
            showLoading(false);
            showBriefsError('Network error: ' + err.message);
        });
    }

    function handleRegenerate() {
        var btn = document.getElementById('gcRecRefreshBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '&#8987; Generating...';
        }

        showStatus('Regenerating creative briefs using latest performance data...', '#6c5ce7');

        fetch('/creative-portal/api/gc/recommendations/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        })
        .then(function(r) { return r.json(); })
        .then(function(result) {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '&#10024; Regenerate Briefs';
            }

            if (result.success) {
                showStatus('Briefs regenerated successfully!', '#00d4aa');
                setTimeout(function() { hideStatus(); }, 4000);
                fetchBriefs();
            } else {
                showStatus('Failed to regenerate: ' + (result.error || 'Unknown error'), 'var(--red, #ef4444)');
            }
        })
        .catch(function(err) {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '&#10024; Regenerate Briefs';
            }
            showStatus('Network error: ' + err.message, 'var(--red, #ef4444)');
        });
    }

    function showLoading(show) {
        var el = document.getElementById('gcRecLoading');
        if (el) el.style.display = show ? '' : 'none';
        var briefs = document.getElementById('gcRecBriefs');
        if (briefs && show) briefs.innerHTML = '';
    }

    function showStatus(msg, color) {
        var el = document.getElementById('gcRecStatus');
        if (!el) return;
        el.style.display = '';
        el.innerHTML = '<div style="padding:12px 18px;background:rgba(255,255,255,0.02);border:1px solid ' + color + ';border-radius:10px;color:' + color + ';font-size:13px;font-weight:500;margin-bottom:16px;">' + GC.esc(msg) + '</div>';
    }

    function hideStatus() {
        var el = document.getElementById('gcRecStatus');
        if (el) el.style.display = 'none';
    }

    function showBriefsError(msg) {
        var el = document.getElementById('gcRecBriefs');
        if (el) {
            el.innerHTML = '<div class="gc-error" style="grid-column:1/-1;">' + GC.esc(msg) + '</div>';
        }
    }

    // ---- Render Briefs ----

    function getFilteredBriefs() {
        if (_currentType === 'all') return _briefs;
        return _briefs.filter(function(b) {
            var bType = (b.ad_type || b.format || b.type || '').toUpperCase();
            return bType.indexOf(_currentType.toUpperCase()) >= 0;
        });
    }

    function renderBriefs() {
        var el = document.getElementById('gcRecBriefs');
        if (!el) return;

        var items = getFilteredBriefs();

        if (items.length === 0) {
            el.innerHTML = '<div class="gc-empty" style="grid-column:1/-1;">' +
                '<div class="gc-empty-icon">&#128221;</div>' +
                '<div class="gc-empty-text">No briefs match the selected filter. Try "All Briefs" or regenerate.</div>' +
            '</div>';
            return;
        }

        var html = '';
        items.forEach(function(brief, idx) {
            var adType = brief.ad_type || brief.format || brief.type || 'RSA';
            var adTypeNorm = normalizeAdType(adType);
            var typeBadge = '<span class="gc-badge ' + GC.typeBadgeClass(adTypeNorm) + '">' + GC.esc(adTypeNorm) + '</span>';

            // Headlines
            var headlinesHtml = '';
            var headlines = brief.headlines || brief.key_headlines || [];
            if (typeof headlines === 'string') headlines = [headlines];
            if (headlines.length > 0) {
                headlinesHtml = '<div class="gc-brief-headlines">';
                headlines.slice(0, 4).forEach(function(h) {
                    headlinesHtml += '<div class="gc-brief-headline-item">"' + GC.esc(h) + '"</div>';
                });
                if (headlines.length > 4) {
                    headlinesHtml += '<div style="font-size:11px;color:var(--text-dim);padding-top:4px;">+' + (headlines.length - 4) + ' more</div>';
                }
                headlinesHtml += '</div>';
            }

            // Rationale
            var rationale = brief.rationale || brief.hypothesis || brief.reasoning || '';

            // Specs
            var specs = [];
            if (brief.format_specs) {
                if (typeof brief.format_specs === 'string') {
                    specs.push(brief.format_specs);
                } else if (typeof brief.format_specs === 'object') {
                    Object.keys(brief.format_specs).forEach(function(k) {
                        specs.push(k + ': ' + brief.format_specs[k]);
                    });
                }
            }
            if (brief.char_limits) specs.push('Chars: ' + brief.char_limits);
            if (brief.dimensions) specs.push(brief.dimensions);
            if (brief.duration) specs.push(brief.duration);
            if (brief.aspect_ratio) specs.push(brief.aspect_ratio);
            if (brief.budget_recommendation) specs.push('Budget: ' + brief.budget_recommendation);

            var specsHtml = '';
            if (specs.length > 0) {
                specsHtml = '<div class="gc-brief-specs">';
                specs.forEach(function(s) {
                    specsHtml += '<span class="gc-brief-spec">' + GC.esc(s) + '</span>';
                });
                specsHtml += '</div>';
            }

            // Full copy for clipboard
            var fullCopy = buildBriefCopyText(brief, adTypeNorm, headlines);

            html += '<div class="gc-brief-card" data-brief-idx="' + idx + '">' +
                '<div class="gc-brief-header">' +
                    typeBadge +
                    (brief.confidence ? '<span style="font-size:10px;color:var(--text-dim);">' + GC.esc(brief.confidence) + ' confidence</span>' : '') +
                '</div>' +
                '<div class="gc-brief-title">' + GC.esc(brief.title || brief.name || 'Brief #' + (idx + 1)) + '</div>' +
                headlinesHtml +
                (rationale ? '<div class="gc-brief-rationale">' + GC.esc(rationale) + '</div>' : '') +
                specsHtml +
                '<div class="gc-brief-actions">' +
                    '<button class="gc-btn-copy gc-copy-brief" data-copy="' + escapeAttr(fullCopy) + '">&#128203; Copy Brief</button>' +
                '</div>' +
            '</div>';
        });

        el.innerHTML = html;

        // Bind copy buttons
        el.querySelectorAll('.gc-copy-brief').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var text = this.getAttribute('data-copy');
                copyToClipboard(text, this);
            });
        });
    }

    function normalizeAdType(type) {
        if (!type) return 'RSA';
        var t = type.toUpperCase();
        if (t.indexOf('RSA') >= 0 || t.indexOf('RESPONSIVE SEARCH') >= 0) return 'RSA';
        if (t.indexOf('VIDEO') >= 0) return 'Video';
        if (t.indexOf('PMAX') >= 0 || t.indexOf('PERFORMANCE MAX') >= 0) return 'PMax';
        if (t.indexOf('DISPLAY') >= 0) return 'Display';
        return type;
    }

    function buildBriefCopyText(brief, adType, headlines) {
        var lines = [];
        lines.push('=== Google Ads Creative Brief ===');
        lines.push('Type: ' + adType);
        lines.push('Title: ' + (brief.title || brief.name || ''));
        lines.push('');
        if (headlines.length > 0) {
            lines.push('Headlines:');
            headlines.forEach(function(h, i) { lines.push('  ' + (i + 1) + '. ' + h); });
            lines.push('');
        }
        if (brief.descriptions) {
            var descs = Array.isArray(brief.descriptions) ? brief.descriptions : [brief.descriptions];
            lines.push('Descriptions:');
            descs.forEach(function(d, i) { lines.push('  ' + (i + 1) + '. ' + d); });
            lines.push('');
        }
        if (brief.rationale || brief.hypothesis) {
            lines.push('Rationale: ' + (brief.rationale || brief.hypothesis));
            lines.push('');
        }
        if (brief.full_script) {
            lines.push('Full Script/Copy:');
            lines.push(brief.full_script);
            lines.push('');
        }
        if (brief.visual_direction) {
            lines.push('Visual Direction: ' + (typeof brief.visual_direction === 'string' ? brief.visual_direction : JSON.stringify(brief.visual_direction)));
            lines.push('');
        }
        if (brief.budget_recommendation) {
            lines.push('Budget: ' + brief.budget_recommendation);
        }
        return lines.join('\n');
    }

    function escapeAttr(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function copyToClipboard(text, btn) {
        if (!text) return;

        // Decode HTML entities back
        var decoded = text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(decoded).then(function() {
                showCopyFeedback(btn, true);
            }).catch(function() {
                fallbackCopy(decoded, btn);
            });
        } else {
            fallbackCopy(decoded, btn);
        }
    }

    function fallbackCopy(text, btn) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showCopyFeedback(btn, true);
        } catch (e) {
            showCopyFeedback(btn, false);
        }
        document.body.removeChild(ta);
    }

    function showCopyFeedback(btn, success) {
        if (!btn) return;
        var original = btn.innerHTML;
        btn.innerHTML = success ? '&#9989; Copied!' : '&#10060; Failed';
        btn.disabled = true;
        setTimeout(function() {
            btn.innerHTML = original;
            btn.disabled = false;
        }, 2000);
    }

})();
