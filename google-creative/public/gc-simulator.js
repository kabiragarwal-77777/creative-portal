(function() {
    'use strict';

    var GC = window.GC || {};
    var _selectedAdType = 'RSA';
    var _predictionResult = null;
    var _simulations = [];
    var _selectedSimId = null;
    var _loaded = false;

    document.addEventListener('gc-tab-activated', function(e) {
        if (e.detail && e.detail.tab === 'simulator') {
            loadSimulator();
        }
    });

    function loadSimulator() {
        var container = document.getElementById('gcSimulatorView');
        if (!container) return;

        if (!_loaded) {
            _loaded = true;
            container.innerHTML = buildShell();
            bindEvents();
            updateFormForType(_selectedAdType);
        }

        fetchSimulations();
    }

    function buildShell() {
        return '' +
        '<div class="gc-panel">' +
            // Header
            '<div class="gc-header">' +
                '<h2>Google Ads ROAS Simulator</h2>' +
                '<p>Predict ROAS performance for new Google ad creatives before they go live</p>' +
            '</div>' +

            // Ad Type Selector
            '<div class="gc-section">' +
                '<div class="gc-section-title">&#127919; Ad Configuration</div>' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Ad Type</label>' +
                    '<div class="gc-pill-toggle" id="gcSimTypeToggle">' +
                        '<button class="gc-pill-btn active" data-type="RSA">RSA</button>' +
                        '<button class="gc-pill-btn" data-type="Video">Video</button>' +
                        '<button class="gc-pill-btn" data-type="PMax">PMax</button>' +
                        '<button class="gc-pill-btn" data-type="Display">Display</button>' +
                    '</div>' +
                '</div>' +

                // Dynamic form area
                '<div id="gcSimFormArea"></div>' +

                // Budget
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Daily Budget (\u20B9)</label>' +
                    '<input type="number" id="gcSimBudget" class="gc-form-input" placeholder="e.g. 5000" style="max-width:200px;">' +
                '</div>' +

                // Submit
                '<div style="display:flex;gap:10px;margin-top:20px;">' +
                    '<button id="gcSimSubmitBtn" class="gc-btn-teal">&#9889; Predict ROAS</button>' +
                    '<button id="gcSimResetBtn" class="gc-btn-secondary">Reset</button>' +
                '</div>' +
            '</div>' +

            // Loading
            '<div id="gcSimLoading" style="display:none;">' +
                '<div class="gc-loading">' +
                    '<div class="gc-spinner"></div>' +
                    '<div class="gc-loading-text">Running prediction model...</div>' +
                '</div>' +
            '</div>' +

            // Error
            '<div id="gcSimError" style="display:none;"></div>' +

            // Prediction Results
            '<div id="gcSimResults" style="display:none;"></div>' +

            // Separator
            '<div style="border-top:1px solid var(--border, #1e1e2e);margin:28px 0;"></div>' +

            // Tracked Simulations
            '<div class="gc-section">' +
                '<div class="gc-section-title">&#128202; Tracked Simulations</div>' +
                '<div id="gcSimList"></div>' +
            '</div>' +

            // Trendline Chart
            '<div id="gcSimChartArea" style="display:none;"></div>' +
        '</div>';
    }

    function bindEvents() {
        // Ad type toggle
        var toggle = document.getElementById('gcSimTypeToggle');
        if (toggle) {
            toggle.addEventListener('click', function(e) {
                var btn = e.target.closest('.gc-pill-btn');
                if (!btn) return;
                var type = btn.getAttribute('data-type');
                if (!type) return;
                _selectedAdType = type;
                toggle.querySelectorAll('.gc-pill-btn').forEach(function(b) {
                    b.classList.toggle('active', b === btn);
                });
                updateFormForType(type);
            });
        }

        // Submit
        var submitBtn = document.getElementById('gcSimSubmitBtn');
        if (submitBtn) submitBtn.addEventListener('click', handleSubmit);

        // Reset
        var resetBtn = document.getElementById('gcSimResetBtn');
        if (resetBtn) resetBtn.addEventListener('click', handleReset);
    }

    function updateFormForType(type) {
        var area = document.getElementById('gcSimFormArea');
        if (!area) return;

        var html = '';
        switch (type) {
            case 'RSA':
                html = buildRSAForm();
                break;
            case 'Video':
                html = buildVideoForm();
                break;
            case 'PMax':
                html = buildPMaxForm();
                break;
            case 'Display':
                html = buildDisplayForm();
                break;
        }
        area.innerHTML = html;
        bindFormEvents(type);
    }

    function buildRSAForm() {
        var headlineInputs = '';
        for (var i = 1; i <= 5; i++) {
            headlineInputs += '<div class="gc-form-group">' +
                '<label class="gc-form-label">Headline ' + i + (i <= 3 ? ' *' : ' (optional)') + '</label>' +
                '<input type="text" class="gc-form-input gc-rsa-headline" data-idx="' + i + '" maxlength="30" placeholder="Max 30 characters">' +
                '<div class="gc-char-counter"><span class="gc-char-count">0</span>/30</div>' +
            '</div>';
        }

        var descInputs = '';
        for (var j = 1; j <= 3; j++) {
            descInputs += '<div class="gc-form-group">' +
                '<label class="gc-form-label">Description ' + j + (j <= 2 ? ' *' : ' (optional)') + '</label>' +
                '<textarea class="gc-form-textarea gc-rsa-desc" data-idx="' + j + '" maxlength="90" rows="2" placeholder="Max 90 characters"></textarea>' +
                '<div class="gc-char-counter"><span class="gc-char-count">0</span>/90</div>' +
            '</div>';
        }

        return '<div class="gc-form-row">' +
            '<div class="gc-form-col">' + headlineInputs + '</div>' +
            '<div class="gc-form-col">' + descInputs + '</div>' +
        '</div>';
    }

    function buildVideoForm() {
        return '<div class="gc-form-group">' +
            '<label class="gc-form-label">YouTube Video URL *</label>' +
            '<input type="url" id="gcSimYoutubeUrl" class="gc-form-input" placeholder="https://www.youtube.com/watch?v=...">' +
            '<div id="gcSimYtPreview" class="gc-yt-preview" style="margin-top:10px;">' +
                '<span class="gc-yt-preview-empty">Paste a YouTube URL to preview</span>' +
            '</div>' +
        '</div>' +
        '<div class="gc-form-group">' +
            '<label class="gc-form-label">Companion Headline (optional)</label>' +
            '<input type="text" id="gcSimVideoHeadline" class="gc-form-input" maxlength="30" placeholder="Max 30 characters">' +
            '<div class="gc-char-counter"><span class="gc-char-count">0</span>/30</div>' +
        '</div>';
    }

    function buildPMaxForm() {
        return '<div class="gc-form-row">' +
            '<div class="gc-form-col">' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Asset Group Name *</label>' +
                    '<input type="text" id="gcSimPmaxName" class="gc-form-input" placeholder="e.g. Spring Campaign - High Intent">' +
                '</div>' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Headline 1 *</label>' +
                    '<input type="text" class="gc-form-input gc-pmax-headline" maxlength="30" placeholder="Max 30 characters">' +
                    '<div class="gc-char-counter"><span class="gc-char-count">0</span>/30</div>' +
                '</div>' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Headline 2</label>' +
                    '<input type="text" class="gc-form-input gc-pmax-headline" maxlength="30" placeholder="Max 30 characters">' +
                    '<div class="gc-char-counter"><span class="gc-char-count">0</span>/30</div>' +
                '</div>' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Long Headline *</label>' +
                    '<input type="text" id="gcSimPmaxLongHeadline" class="gc-form-input" maxlength="90" placeholder="Max 90 characters">' +
                    '<div class="gc-char-counter"><span class="gc-char-count">0</span>/90</div>' +
                '</div>' +
            '</div>' +
            '<div class="gc-form-col">' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Description 1 *</label>' +
                    '<textarea class="gc-form-textarea gc-pmax-desc" maxlength="90" rows="2" placeholder="Max 90 characters"></textarea>' +
                    '<div class="gc-char-counter"><span class="gc-char-count">0</span>/90</div>' +
                '</div>' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Description 2</label>' +
                    '<textarea class="gc-form-textarea gc-pmax-desc" maxlength="90" rows="2" placeholder="Max 90 characters"></textarea>' +
                    '<div class="gc-char-counter"><span class="gc-char-count">0</span>/90</div>' +
                '</div>' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Target Audience</label>' +
                    '<input type="text" id="gcSimPmaxAudience" class="gc-form-input" placeholder="e.g. 25-45 Male, Finance interests">' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    function buildDisplayForm() {
        return '<div class="gc-form-row">' +
            '<div class="gc-form-col">' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Headline *</label>' +
                    '<input type="text" id="gcSimDisplayHeadline" class="gc-form-input" maxlength="30" placeholder="Max 30 characters">' +
                    '<div class="gc-char-counter"><span class="gc-char-count">0</span>/30</div>' +
                '</div>' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Long Headline</label>' +
                    '<input type="text" id="gcSimDisplayLongHeadline" class="gc-form-input" maxlength="90" placeholder="Max 90 characters">' +
                    '<div class="gc-char-counter"><span class="gc-char-count">0</span>/90</div>' +
                '</div>' +
            '</div>' +
            '<div class="gc-form-col">' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Description *</label>' +
                    '<textarea id="gcSimDisplayDesc" class="gc-form-textarea" maxlength="90" rows="2" placeholder="Max 90 characters"></textarea>' +
                    '<div class="gc-char-counter"><span class="gc-char-count">0</span>/90</div>' +
                '</div>' +
                '<div class="gc-form-group">' +
                    '<label class="gc-form-label">Image URL (optional)</label>' +
                    '<input type="url" id="gcSimDisplayImage" class="gc-form-input" placeholder="https://...">' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    function bindFormEvents(type) {
        // Character counters for all inputs/textareas in the form
        var formArea = document.getElementById('gcSimFormArea');
        if (!formArea) return;

        formArea.querySelectorAll('input[maxlength], textarea[maxlength]').forEach(function(input) {
            input.addEventListener('input', function() {
                var max = parseInt(this.getAttribute('maxlength'), 10);
                var counter = this.parentElement.querySelector('.gc-char-count');
                if (counter) {
                    var len = this.value.length;
                    counter.textContent = len;
                    var wrapper = counter.closest('.gc-char-counter');
                    if (wrapper) {
                        wrapper.classList.toggle('gc-over-limit', len >= max);
                    }
                }
            });
        });

        // YouTube URL preview
        if (type === 'Video') {
            var urlInput = document.getElementById('gcSimYoutubeUrl');
            if (urlInput) {
                urlInput.addEventListener('input', debounce(function() {
                    updateYoutubePreview(urlInput.value);
                }, 500));
            }
        }
    }

    function debounce(fn, delay) {
        var timer;
        return function() {
            var args = arguments;
            var ctx = this;
            clearTimeout(timer);
            timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
        };
    }

    function extractYoutubeId(url) {
        if (!url) return null;
        var match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
        return match ? match[1] : null;
    }

    function updateYoutubePreview(url) {
        var preview = document.getElementById('gcSimYtPreview');
        if (!preview) return;

        var videoId = extractYoutubeId(url);
        if (videoId) {
            preview.innerHTML = '<img src="https://img.youtube.com/vi/' + GC.esc(videoId) + '/hqdefault.jpg" alt="Video thumbnail" onerror="this.parentElement.innerHTML=\'<span class=gc-yt-preview-empty>Could not load thumbnail</span>\'">';
        } else {
            preview.innerHTML = '<span class="gc-yt-preview-empty">Paste a YouTube URL to preview</span>';
        }
    }

    // ---- Collect Form Data ----

    function collectFormData() {
        var data = { adType: _selectedAdType };
        var budget = document.getElementById('gcSimBudget');
        data.budget = budget ? parseFloat(budget.value) || 0 : 0;

        switch (_selectedAdType) {
            case 'RSA':
                data.headlines = [];
                data.descriptions = [];
                document.querySelectorAll('.gc-rsa-headline').forEach(function(el) {
                    if (el.value.trim()) data.headlines.push(el.value.trim());
                });
                document.querySelectorAll('.gc-rsa-desc').forEach(function(el) {
                    if (el.value.trim()) data.descriptions.push(el.value.trim());
                });
                if (data.headlines.length < 3) return { error: 'Please enter at least 3 headlines for RSA' };
                if (data.descriptions.length < 2) return { error: 'Please enter at least 2 descriptions for RSA' };
                break;

            case 'Video':
                var ytUrl = document.getElementById('gcSimYoutubeUrl');
                data.youtubeUrl = ytUrl ? ytUrl.value.trim() : '';
                if (!data.youtubeUrl || !extractYoutubeId(data.youtubeUrl)) {
                    return { error: 'Please enter a valid YouTube URL' };
                }
                var vidHeadline = document.getElementById('gcSimVideoHeadline');
                data.headlines = vidHeadline && vidHeadline.value.trim() ? [vidHeadline.value.trim()] : [];
                break;

            case 'PMax':
                data.headlines = [];
                data.descriptions = [];
                document.querySelectorAll('.gc-pmax-headline').forEach(function(el) {
                    if (el.value.trim()) data.headlines.push(el.value.trim());
                });
                document.querySelectorAll('.gc-pmax-desc').forEach(function(el) {
                    if (el.value.trim()) data.descriptions.push(el.value.trim());
                });
                var pmaxLong = document.getElementById('gcSimPmaxLongHeadline');
                if (pmaxLong && pmaxLong.value.trim()) data.longHeadline = pmaxLong.value.trim();
                var pmaxName = document.getElementById('gcSimPmaxName');
                data.assetGroupName = pmaxName ? pmaxName.value.trim() : '';
                var pmaxAud = document.getElementById('gcSimPmaxAudience');
                data.audience = pmaxAud ? pmaxAud.value.trim() : '';
                if (data.headlines.length < 1) return { error: 'Please enter at least 1 headline for PMax' };
                if (data.descriptions.length < 1) return { error: 'Please enter at least 1 description for PMax' };
                break;

            case 'Display':
                var dHeadline = document.getElementById('gcSimDisplayHeadline');
                var dDesc = document.getElementById('gcSimDisplayDesc');
                data.headlines = dHeadline && dHeadline.value.trim() ? [dHeadline.value.trim()] : [];
                data.descriptions = dDesc && dDesc.value.trim() ? [dDesc.value.trim()] : [];
                var dLong = document.getElementById('gcSimDisplayLongHeadline');
                if (dLong && dLong.value.trim()) data.longHeadline = dLong.value.trim();
                var dImg = document.getElementById('gcSimDisplayImage');
                if (dImg && dImg.value.trim()) data.imageUrl = dImg.value.trim();
                if (data.headlines.length < 1) return { error: 'Please enter a headline for Display' };
                if (data.descriptions.length < 1) return { error: 'Please enter a description for Display' };
                break;
        }

        if (!data.budget || data.budget <= 0) return { error: 'Please enter a daily budget' };

        return data;
    }

    // ---- Submit ----

    function handleSubmit() {
        var data = collectFormData();
        if (data.error) {
            showSimError(data.error);
            return;
        }

        hideSimError();
        showSimLoading(true);
        hideSimResults();

        var submitBtn = document.getElementById('gcSimSubmitBtn');
        if (submitBtn) submitBtn.disabled = true;

        fetch('/creative-portal/api/gc/simulator/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })
        .then(function(r) { return r.json(); })
        .then(function(result) {
            showSimLoading(false);
            if (submitBtn) submitBtn.disabled = false;

            if (result.success && result.data) {
                _predictionResult = result.data;
                renderPredictions(result.data);
                fetchSimulations(); // Refresh list
            } else {
                showSimError(result.error || 'Prediction failed. Please try again.');
            }
        })
        .catch(function(err) {
            showSimLoading(false);
            if (submitBtn) submitBtn.disabled = false;
            showSimError('Network error: ' + err.message);
        });
    }

    function handleReset() {
        updateFormForType(_selectedAdType);
        var budget = document.getElementById('gcSimBudget');
        if (budget) budget.value = '';
        hideSimError();
        hideSimResults();
        _predictionResult = null;
    }

    function showSimLoading(show) {
        var el = document.getElementById('gcSimLoading');
        if (el) el.style.display = show ? '' : 'none';
    }

    function showSimError(msg) {
        var el = document.getElementById('gcSimError');
        if (el) {
            el.style.display = '';
            el.innerHTML = '<div class="gc-error">' + GC.esc(msg) + '</div>';
        }
    }

    function hideSimError() {
        var el = document.getElementById('gcSimError');
        if (el) el.style.display = 'none';
    }

    function hideSimResults() {
        var el = document.getElementById('gcSimResults');
        if (el) el.style.display = 'none';
    }

    // ---- Prediction Results ----

    function renderPredictions(data) {
        var el = document.getElementById('gcSimResults');
        if (!el) return;
        el.style.display = '';

        var predictions = data.predictions || {};
        var days = [
            { key: 'd7', label: 'Day 7' },
            { key: 'd30', label: 'Day 30' },
            { key: 'd60', label: 'Day 60' },
            { key: 'd120', label: 'Day 120' },
            { key: 'd365', label: 'Day 365' }
        ];

        var html = '<div class="gc-section">' +
            '<div class="gc-section-title">&#127919; Predicted ROAS</div>' +
            '<div class="gc-prediction-strip">';

        days.forEach(function(d) {
            var pred = predictions[d.key];
            var roas = pred ? pred.roas : null;
            var confidence = pred ? pred.confidence : null;
            var color = GC.roasColor(roas);

            html += '<div class="gc-prediction-card">' +
                '<div class="gc-prediction-day">' + d.label + '</div>' +
                '<div class="gc-prediction-value" style="color:' + color + ';">' + (roas != null ? GC.fmtPct(roas) : '--') + '</div>' +
                (confidence ? '<div class="gc-prediction-confidence">' + GC.esc(confidence) + ' confidence</div>' : '') +
            '</div>';
        });

        html += '</div>';

        // Summary
        if (data.summary) {
            html += '<div style="padding:14px 18px;background:rgba(108,92,231,0.06);border:1px solid rgba(108,92,231,0.15);border-radius:10px;margin-top:16px;">' +
                '<div style="font-size:12px;font-weight:600;color:#6c5ce7;margin-bottom:6px;">Analysis</div>' +
                '<div style="font-size:13px;color:var(--text);line-height:1.6;">' + GC.esc(data.summary) + '</div>' +
            '</div>';
        }

        html += '</div>';
        el.innerHTML = html;
    }

    // ---- Simulations List ----

    function fetchSimulations() {
        fetch('/creative-portal/api/gc/simulator/simulations')
        .then(function(r) { return r.json(); })
        .then(function(result) {
            if (result.success && result.data) {
                _simulations = result.data;
                renderSimulations();
            }
        })
        .catch(function() {
            // Silent fail for list
        });
    }

    function renderSimulations() {
        var el = document.getElementById('gcSimList');
        if (!el) return;

        if (!_simulations || _simulations.length === 0) {
            el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-dim);font-size:13px;">' +
                'No simulations yet. Submit a prediction above to start tracking.' +
            '</div>';
            return;
        }

        var html = '<div class="gc-scroll-y">';
        _simulations.forEach(function(sim) {
            var isSelected = _selectedSimId === sim.id;
            var typeBadge = '<span class="gc-badge ' + GC.typeBadgeClass(sim.ad_type) + '">' + GC.esc(sim.ad_type) + '</span>';
            var dateStr = sim.created_at ? new Date(sim.created_at).toLocaleDateString() : '';

            html += '<div class="gc-sim-row' + (isSelected ? ' gc-sim-selected' : '') + '" data-sim-id="' + GC.esc(sim.id) + '">' +
                typeBadge +
                '<div class="gc-sim-name">' + GC.esc(sim.name || sim.headlines_preview || 'Simulation #' + sim.id) + '</div>' +
                '<div class="gc-sim-meta">' +
                    (sim.predicted_d30_roas != null ? '<span style="color:' + GC.roasColor(sim.predicted_d30_roas) + ';font-weight:600;">D30: ' + GC.fmtPct(sim.predicted_d30_roas) + '</span>' : '') +
                    (dateStr ? ' &middot; ' + dateStr : '') +
                '</div>' +
            '</div>';
        });
        html += '</div>';

        el.innerHTML = html;

        // Bind click events
        el.querySelectorAll('.gc-sim-row').forEach(function(row) {
            row.addEventListener('click', function() {
                var simId = this.getAttribute('data-sim-id');
                selectSimulation(simId);
            });
        });
    }

    function selectSimulation(simId) {
        _selectedSimId = simId;

        // Update selected state
        document.querySelectorAll('.gc-sim-row').forEach(function(row) {
            row.classList.toggle('gc-sim-selected', row.getAttribute('data-sim-id') === simId);
        });

        // Fetch timeseries
        var chartArea = document.getElementById('gcSimChartArea');
        if (!chartArea) return;

        chartArea.style.display = '';
        chartArea.innerHTML = '<div class="gc-sim-chart-container">' +
            '<div class="gc-loading">' +
                '<div class="gc-spinner"></div>' +
                '<div class="gc-loading-text">Loading trendline data...</div>' +
            '</div>' +
        '</div>';

        fetch('/creative-portal/api/gc/simulator/' + encodeURIComponent(simId) + '/timeseries')
        .then(function(r) { return r.json(); })
        .then(function(result) {
            if (result.success && result.data) {
                renderTrendlineChart(result.data);
            } else {
                chartArea.innerHTML = '<div class="gc-sim-chart-container">' +
                    '<div class="gc-error">' + GC.esc(result.error || 'Failed to load trendline data') + '</div>' +
                '</div>';
            }
        })
        .catch(function(err) {
            chartArea.innerHTML = '<div class="gc-sim-chart-container">' +
                '<div class="gc-error">Network error: ' + GC.esc(err.message) + '</div>' +
            '</div>';
        });
    }

    function renderTrendlineChart(data) {
        var chartArea = document.getElementById('gcSimChartArea');
        if (!chartArea) return;

        var predicted = data.predicted || [];
        var actual = data.actual || [];

        chartArea.innerHTML = '<div class="gc-sim-chart-container">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
                '<h4 style="font-size:14px;font-weight:600;color:var(--text);margin:0;">Predicted vs Actual ROAS</h4>' +
                '<div class="gc-trendline-legend">' +
                    '<div class="gc-legend-item"><div class="gc-legend-swatch" style="background:#6c5ce7;"></div> Predicted</div>' +
                    '<div class="gc-legend-item"><div class="gc-legend-swatch" style="background:#00d4aa;"></div> Actual</div>' +
                '</div>' +
            '</div>' +
            '<canvas id="gcSimTrendCanvas" style="width:100%;height:240px;"></canvas>' +
        '</div>';

        // Draw chart
        setTimeout(function() {
            drawTrendline(predicted, actual);
        }, 50);
    }

    function drawTrendline(predicted, actual) {
        var canvas = document.getElementById('gcSimTrendCanvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.parentElement.getBoundingClientRect();
        var w = rect.width - 20;
        var h = 240;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        // Merge all days
        var allDays = [];
        var predMap = {};
        var actMap = {};
        predicted.forEach(function(p) { predMap[p.day] = p.roas; if (allDays.indexOf(p.day) < 0) allDays.push(p.day); });
        actual.forEach(function(a) { actMap[a.day] = a.roas; if (allDays.indexOf(a.day) < 0) allDays.push(a.day); });
        allDays.sort(function(a, b) { return a - b; });

        if (allDays.length === 0) {
            ctx.fillStyle = '#71717a';
            ctx.font = '13px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No trendline data available', w / 2, h / 2);
            return;
        }

        var allVals = allDays.map(function(d) { return predMap[d] || 0; }).concat(allDays.map(function(d) { return actMap[d] || 0; })).filter(function(v) { return v > 0; });
        var maxVal = allVals.length > 0 ? Math.max.apply(null, allVals) : 1;
        var minVal = allVals.length > 0 ? Math.min.apply(null, allVals) : 0;
        var range = maxVal - minVal || 1;

        var chartLeft = 50;
        var chartRight = w - 20;
        var chartTop = 15;
        var chartBottom = h - 30;
        var chartWidth = chartRight - chartLeft;
        var chartHeight = chartBottom - chartTop;

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.fillStyle = '#71717a';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        for (var g = 0; g <= 4; g++) {
            var gVal = minVal + (range / 4) * g;
            var gy = chartBottom - (chartHeight * (g / 4));
            ctx.beginPath();
            ctx.moveTo(chartLeft, gy);
            ctx.lineTo(chartRight, gy);
            ctx.stroke();
            ctx.fillText(gVal.toFixed(1) + '%', chartLeft - 6, gy + 3);
        }

        // X labels
        ctx.textAlign = 'center';
        var maxDays = allDays[allDays.length - 1] || 1;
        var labelStep = Math.max(1, Math.floor(allDays.length / 6));
        for (var xi = 0; xi < allDays.length; xi += labelStep) {
            var xPos = chartLeft + (allDays[xi] / maxDays) * chartWidth;
            ctx.fillText('D' + allDays[xi], xPos, chartBottom + 14);
        }

        // Draw predicted line
        drawLine(ctx, allDays, predMap, maxDays, minVal, range, chartLeft, chartBottom, chartWidth, chartHeight, '#6c5ce7', 2);

        // Draw actual line
        drawLine(ctx, allDays, actMap, maxDays, minVal, range, chartLeft, chartBottom, chartWidth, chartHeight, '#00d4aa', 2);
    }

    function drawLine(ctx, days, map, maxDays, minVal, range, chartLeft, chartBottom, chartWidth, chartHeight, color, lineWidth) {
        var points = [];
        days.forEach(function(d) {
            if (map[d] != null && map[d] > 0) {
                points.push({
                    x: chartLeft + (d / maxDays) * chartWidth,
                    y: chartBottom - ((map[d] - minVal) / range) * chartHeight
                });
            }
        });

        if (points.length < 2) return;

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';
        points.forEach(function(p, i) {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();

        // Dots
        points.forEach(function(p) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        });
    }

})();
