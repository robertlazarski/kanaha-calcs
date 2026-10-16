// kanaha-calcs: Scenario Analysis UI
// Generic expected value calculator (Bull/Base/Bear).
// Bernoulli (1738) / Huygens (1657).

/*
 * Axis2/C calls go through the Java bridge (Android.callAxis2) because:
 * 1. Axis2/C JSON requires HTTP/2, which needs TLS (ALPN negotiation)
 * 2. The service requires a client certificate (mTLS)
 * 3. WebView fetch() cannot present a client cert and has no override hook
 * 4. The Java bridge (Axis2Client) presents the device's own provisioned
 *    cert and trusts the Kanaha CA cert pushed with it
 */
function callAxis2(path, payload) {
    return new Promise(function(resolve, reject) {
        try {
            var response = Android.callAxis2(path, JSON.stringify(payload));
            // Axis2/C may return NaN/Infinity in JSON which JS rejects.
            // Replace with null before parsing.
            response = response.replace(/\bNaN\b/g, 'null').replace(/\bInfinity\b/g, 'null');
            var data = JSON.parse(response);
            // Three failure shapes: the bridge's {"error": "..."}, the
            // engine's {"error": {"message": ...}}, and the service's
            // {"status": "FAILED", "error_message": ...}. A card that read a
            // FAILED reply as data would show a blank result, not the reason.
            if (data.error) {
                reject(new Error(data.error.message || data.error));
            } else if (data.status === 'FAILED') {
                reject(new Error(data.error_message || 'the service reported FAILED'));
            } else {
                resolve(data);
            }
        } catch (e) {
            reject(e);
        }
    });
}

/** Add a scenario row to the table. */
function addScenarioRow() {
    var tbody = document.getElementById('scenario-rows');
    var rowCount = tbody.children.length + 1;
    var tr = document.createElement('tr');
    tr.innerHTML =
        '<td><input type="text" class="scenario-label" maxlength="32" value="Scenario ' + rowCount + '" style="width:80px"></td>' +
        '<td><input type="number" class="scenario-prob" step="1" min="0" max="100" value="0" style="width:60px" onchange="validateScenarioProbs()">%</td>' +
        '<td><input type="number" class="scenario-value" step="0.01" value="0" style="width:80px"></td>' +
        '<td><button class="remove-row-btn" onclick="this.closest(\'tr\').remove();validateScenarioProbs()">×</button></td>';
    tbody.appendChild(tr);
    validateScenarioProbs();
}

/** Validate that probabilities sum to 100%. */
function validateScenarioProbs() {
    var inputs = document.querySelectorAll('.scenario-prob');
    var total = 0;
    for (var i = 0; i < inputs.length; i++) {
        total += parseFloat(inputs[i].value) || 0;
    }
    var status = document.getElementById('scenario-prob-status');
    if (Math.abs(total - 100) < 0.01) {
        status.textContent = 'Probabilities sum to 100%';
        status.style.color = 'var(--accent)';
    } else {
        status.textContent = 'Probabilities sum to ' + total.toFixed(1) + '% (must be 100%)';
        status.style.color = 'var(--negative)';
    }
}

/** Auto-fill current price from loaded data when ticker changes. */
function updateScenarioCurrentPrice() {
    if (!appData.loaded) return;
    var ticker = document.getElementById('scenario-ticker').value;
    var prices = appData.adjClose[ticker];
    if (prices && prices.length > 0) {
        var price = prices[prices.length - 1];
        document.getElementById('scenario-current-price').value = price.toFixed(2);
        document.querySelectorAll('.scenario-value[data-mult]').forEach(function(el) {
            el.value = (price * parseFloat(el.dataset.mult)).toFixed(2);
        });
    }
}

/*
 * Compute scenario expected value via Axis2/C native service.
 * No JS fallback by design: the whole point of these Axis2/C calcs is to
 * validate the native binary pipeline (cross-compile, deploy, IPC). A failed
 * call shows the service's own reason.
 */
function calcScenario() {
    var labels = document.querySelectorAll('.scenario-label');
    var probs = document.querySelectorAll('.scenario-prob');
    var values = document.querySelectorAll('.scenario-value');

    var scenarios = [];
    var probTotal = 0;
    for (var i = 0; i < probs.length; i++) {
        var p = (parseFloat(probs[i].value) || 0) / 100;
        var v = parseFloat(values[i].value) || 0;
        probTotal += p;
        scenarios.push({
            label: labels[i].value,
            probability: p,
            value: v
        });
    }

    if (Math.abs(probTotal - 1.0) > 0.001) {
        document.getElementById('scenario-result').textContent = 'Probabilities must sum to 100%';
        document.getElementById('scenario-result').className = 'result negative';
        return;
    }

    var ticker = document.getElementById('scenario-ticker');
    var tickerVal = ticker ? ticker.value : '';
    var currentPriceInput = document.getElementById('scenario-current-price');
    var currentPrice = parseFloat(currentPriceInput.value) || 100;

    if (currentPrice <= 0) {
        document.getElementById('scenario-result').textContent = 'Current price must be > 0';
        document.getElementById('scenario-result').className = 'result negative';
        return;
    }

    // C service expects: { assets: [{ ticker, current_price, scenarios: [{label, probability, value}] }] }
    var payload = {
        assets: [{
            ticker: tickerVal || 'ASSET',
            current_price: currentPrice,
            position_size: 1,
            scenarios: scenarios.map(function(s) {
                return { label: s.label, probability: s.probability, price: s.value };
            })
        }]
    };

    var resultEl = document.getElementById('scenario-result');
    resultEl.textContent = 'Calling Axis2/C...';
    resultEl.className = 'result';

    callAxis2('/scenarioAnalysis', payload)
    .then(function(data) {
        showScenarioResult(data.weighted_value, data.expected_return,
                           currentPrice, data.calc_time_us);
    })
    .catch(function(e) {
        resultEl.textContent = 'Native service error: ' + e.message;
        resultEl.className = 'result negative';
        resultEl.style.fontSize = '13px';
    });
}

/**
 * Display the expected value in dollars, as the card's formula defines it,
 * with the expected return against the current price beside it.
 */
function showScenarioResult(ev, expectedReturn, currentPrice, calcTimeUs) {
    var el = document.getElementById('scenario-result');
    if (!isFinite(ev) || !isFinite(expectedReturn)) {
        el.textContent = '—';
        el.className = 'result';
        return;
    }
    el.textContent = 'EV $' + ev.toFixed(2) + ' (' +
        (expectedReturn >= 0 ? '+' : '') + (expectedReturn * 100).toFixed(1) +
        '% vs $' + currentPrice.toFixed(2) + ')';
    el.className = 'result ' + (expectedReturn >= 0 ? 'positive' : 'negative');
    el.style.fontSize = '';
    var info = document.getElementById('scenario-info');
    info.textContent = 'Axis2/C' + (calcTimeUs ? ' (' + calcTimeUs + ' μs)' : '');
}

/*
 * Portfolio Variance: w'*Sigma*w (quadratic form).
 * Covariance matrix is computed in JS, then sent to Axis2/C for the matrix
 * multiply. This split lets us validate the C BLAS-style multiply against
 * known JS results. The matrix is flattened to row-major (same as C arrays).
 */
/*
 * The CSV files the native operations can read, cached for the session.
 *
 * The page and the C service do not share data. The page parses a CSV into
 * memory; covarianceFromCsv opens a file under the app's own storage. So a
 * card that wants the matrix built in C has to name a file the service can
 * see, and listCsvFiles is the only honest source for that name.
 */
var nativeCsvListing = null;

function loadNativeCsvListing(forceRefresh) {
    if (nativeCsvListing && !forceRefresh) return Promise.resolve(nativeCsvListing);
    return callAxis2('/listCsvFiles', {}).then(function(data) {
        nativeCsvListing = (data && data.files) ? data.files : [];
        return nativeCsvListing;
    });
}

/*
 * Pick the file that can answer for these tickers. Prefers the file the page
 * itself loaded, so the card and the Loaded Data panel never describe
 * different data; falls back to any file carrying every column needed.
 */
function chooseNativeCsv(files, columns) {
    var usable = [];
    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var cols = f.columns || [];
        var complete = true;
        for (var c = 0; c < columns.length; c++) {
            if (cols.indexOf(columns[c]) < 0) { complete = false; break; }
        }
        if (complete) usable.push(f);
    }
    if (usable.length === 0) return null;

    // data.js prefers these bundled files in this order; match it, so the
    // matrix comes from the same file the page is showing. Order matters:
    // a vendor file is current, the WIKI file is the frozen 2008-2018 public
    // decade. Silently preferring the older one would report a different
    // volatility for the same book.
    var preferred = ['vendor_daily_closes.csv', 'wiki_2008_2018_daily_closes.csv'];
    for (var p = 0; p < preferred.length; p++) {
        for (var u = 0; u < usable.length; u++) {
            if (usable[u].file === preferred[p]) return usable[u];
        }
    }
    return usable[0];
}

function calcPortfolioVariance() {
    if (!appData.loaded) return;
    var checkboxes = document.querySelectorAll('#pv-tickers input[type=checkbox]:checked');
    var tickers = [];
    for (var i = 0; i < checkboxes.length; i++) tickers.push(checkboxes[i].value);
    if (tickers.length < 2) {
        document.getElementById('pv-result').textContent = 'Select at least 2 tickers';
        return;
    }

    var n = tickers.length;
    var weights = [];
    for (var i = 0; i < n; i++) weights.push(1.0 / n);

    var resultEl = document.getElementById('pv-result');
    var infoEl = document.getElementById('pv-info');
    resultEl.textContent = 'Calling Axis2/C...';
    resultEl.className = 'result';

    function show(variance, calcUs, provenance) {
        var vol = Math.sqrt(variance) * 100;
        resultEl.textContent = 'Variance: ' + variance.toFixed(6) + '  |  Vol: ' + vol.toFixed(2) + '%';
        resultEl.className = 'result positive';
        resultEl.style.fontSize = '14px';
        infoEl.textContent = 'Equal-weight portfolio (' + tickers.join(', ') + ')' +
            (calcUs ? ' — ' + calcUs + ' μs' : '') + (provenance ? ' — ' + provenance : '');
    }

    function fail(message) {
        resultEl.textContent = message;
        resultEl.className = 'result negative';
        resultEl.style.fontSize = '13px';
    }

    /* The matrix in JavaScript, the multiplication in C: what this card did
     * before the service could read a file. Kept as the fallback so a missing
     * or unreadable CSV degrades to the old behaviour instead of no answer. */
    function varianceFromJsMatrix() {
        var matrix = covarianceMatrix(tickers);
        if (!matrix) { fail('Not enough overlapping data for those tickers'); return; }
        var flat = [];
        for (var i = 0; i < n; i++) {
            for (var j = 0; j < n; j++) flat.push(matrix[i][j]);
        }
        callNativePortfolioVariance(weights, flat)
            .then(function(data) {
                show(data.portfolio_variance || data.variance || 0, data.calc_time_us,
                     'matrix computed in JavaScript');
            })
            .catch(function(e) {
                fail('Native service error: ' + e.message);
            });
    }

    /* Both halves in C: covarianceFromCsv reads the device's own file and
     * returns Σ annualised, portfolioVariance multiplies it out. Σ is already
     * annual, hence n_periods_per_year 1 on the second call — passing 252
     * again would annualise twice. */
    var columns = [];
    for (var t = 0; t < n; t++) columns.push(tickers[t] + '_AdjClose');

    function varianceFromNativeMatrix(chosen) {
        return callAxis2('/covarianceFromCsv', {
            file: chosen.file,
            columns: columns,
            asset_ids: tickers,
            n_periods_per_year: 252
        }).then(function(cov) {
            if (cov.status !== 'SUCCESS' || !cov.covariance_matrix) {
                throw new Error(cov.error_message || 'covarianceFromCsv failed');
            }
            return callAxis2('/portfolioVariance', {
                n_assets: n,
                weights: weights,
                covariance_matrix: cov.covariance_matrix,
                n_periods_per_year: 1
            }).then(function(pv) {
                var window = (cov.first_row_date && cov.last_row_date)
                    ? cov.first_row_date + ' to ' + cov.last_row_date : '';
                var us = (cov.calc_time_us || 0) + (pv.calc_time_us || 0);
                show(pv.portfolio_variance || pv.variance || 0, us,
                     'matrix built in C from ' + chosen.file + ', ' +
                     cov.n_obs_used + ' observations' + (window ? ', ' + window : ''));
            });
        });
    }

    loadNativeCsvListing(false)
        .then(function(files) {
            var chosen = chooseNativeCsv(files, columns);
            if (chosen) return varianceFromNativeMatrix(chosen);

            /* The cached listing can predate an import, or a file that arrived
             * after this page loaded. Ask the device once more before deciding
             * the matrix has to be built in JavaScript. */
            return loadNativeCsvListing(true).then(function(fresh) {
                var refreshed = chooseNativeCsv(fresh, columns);
                if (!refreshed) return varianceFromJsMatrix();
                return varianceFromNativeMatrix(refreshed);
            });
        })
        .catch(function() {
            varianceFromJsMatrix();
        });
}

/** Call Axis2/C portfolio variance via Java bridge. */
function callNativePortfolioVariance(weights, covMatrix) {
    return callAxis2('/portfolioVariance', {
        weights: weights,
        covariance_matrix: covMatrix
    });
}

/*
 * Monte Carlo VaR via Axis2/C. The C implementation uses a Mersenne Twister
 * PRNG and geometric Brownian motion: dS = mu*S*dt + sigma*S*dW.
 * 10,000 simulations is the sweet spot — fast enough on ARM (<50ms in C)
 * but statistically stable for 95%/99% VaR percentiles.
 */
function callNativeMonteCarlo(ticker, currentPrice, annReturn, annVol, days, simulations, model) {
    // C service field names: initial_value (not current_price!), expected_return,
    // volatility, n_periods, n_simulations. Default initial_value is $1M if omitted.
    var payload = {
        ticker: ticker,
        initial_value: currentPrice,
        expected_return: annReturn,
        volatility: annVol,
        n_periods: days || 252,
        n_simulations: simulations || 10000
    };
    if (model && model !== 'gbm') {
        payload.model = model;
    }
    return callAxis2('/monteCarlo', payload);
}

/** Show/hide custom date range inputs based on dropdown selection. */
function toggleMcDateRange() {
    var sel = document.getElementById('mc-lookback');
    var dateRange = document.getElementById('mc-date-range');
    if (sel.value === 'custom') {
        dateRange.style.display = 'block';
        // Default to dataset bounds if not already set
        if (!document.getElementById('mc-date-start').value && appData.loaded) {
            document.getElementById('mc-date-start').value = appData.dates[0];
            document.getElementById('mc-date-end').value = appData.dates[appData.dates.length - 1];
        }
    } else {
        dateRange.style.display = 'none';
    }
}

/** Run Monte Carlo for selected ticker. */
function calcMonteCarlo() {
    if (!appData.loaded) return;
    var ticker = document.getElementById('mc-ticker').value;
    var prices = appData.adjClose[ticker];
    if (!prices || prices.length < 2) return;

    // Volatility source: "same" or "ticker:ACWI"
    var volSourceVal = document.getElementById('mc-vol-source').value;
    var volTicker = ticker;
    if (volSourceVal.indexOf('ticker:') === 0) {
        volTicker = volSourceVal.substring(7);
    }

    // Date range: day count, "custom", or 0 (all)
    var lookbackVal = document.getElementById('mc-lookback').value;
    var lookbackDays = 0;
    var customStart = null;
    var customEnd = null;

    if (lookbackVal === 'custom') {
        customStart = document.getElementById('mc-date-start').value;
        customEnd = document.getElementById('mc-date-end').value;
        if (!customStart || !customEnd) {
            document.getElementById('mc-result').textContent = 'Select both start and end dates';
            document.getElementById('mc-result').className = 'result negative';
            return;
        }
    } else {
        lookbackDays = parseInt(lookbackVal) || 0;
    }

    // Compute log returns from the vol ticker, then trim to date range
    var allRets = logReturns(volTicker);
    var rets;

    if (customStart) {
        // Custom date range: find index positions in dates array
        var startIdx = -1, endIdx = -1;
        for (var i = 0; i < appData.dates.length; i++) {
            if (startIdx === -1 && appData.dates[i] >= customStart) startIdx = i;
            if (appData.dates[i] <= customEnd) endIdx = i;
        }
        if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
            document.getElementById('mc-result').textContent = 'No data in selected date range';
            document.getElementById('mc-result').className = 'result negative';
            return;
        }
        // logReturns are offset by 1 (return[0] = price[1]/price[0])
        var retStart = Math.max(0, startIdx - 1);
        var retEnd = Math.min(allRets.length, endIdx);
        rets = allRets.slice(retStart, retEnd);
    } else {
        rets = (lookbackDays > 0 && allRets.length > lookbackDays)
            ? allRets.slice(allRets.length - lookbackDays)
            : allRets;
    }

    // Determine which dates correspond to the lookback window
    var volPrices = appData.adjClose[volTicker];
    var lookbackStartDate, lookbackEndDate;

    if (customStart) {
        lookbackStartDate = customStart;
        lookbackEndDate = customEnd;
    } else {
        var lookbackStartIdx = volPrices.length - rets.length - 1;
        lookbackStartDate = appData.dates[Math.max(0, lookbackStartIdx)];
        lookbackEndDate = appData.dates[appData.dates.length - 1];
    }

    // Build label: combine vol source + date range
    var volLabel = (volTicker !== ticker) ? volTicker + '\'s characteristics' : '';
    var dateLabel;
    if (customStart) {
        dateLabel = customStart + ' to ' + customEnd + ' (' + rets.length + ' days)';
    } else if (lookbackDays > 0) {
        dateLabel = 'last ' + (lookbackDays > 252 ? Math.round(lookbackDays / 252) + ' years' : '1 year')
          + ' (' + rets.length + ' days)';
    } else {
        dateLabel = 'all data (' + rets.length + ' days)';
    }
    var lookbackLabel = volLabel ? volLabel + ', ' + dateLabel : dateLabel;

    // Compute annualized return and volatility from the lookback window
    var mean = 0;
    for (var i = 0; i < rets.length; i++) mean += rets[i];
    mean /= rets.length;
    var variance = 0;
    for (var i = 0; i < rets.length; i++) {
        var d = rets[i] - mean;
        variance += d * d;
    }
    variance /= (rets.length - 1);
    var annReturn = mean * 252;
    var annVol = Math.sqrt(variance * 252);
    var currentPrice = prices[prices.length - 1];

    // Model selection
    var model = document.getElementById('mc-model').value;

    var resultEl = document.getElementById('mc-result');
    resultEl.textContent = 'Running 10,000 simulations...';
    resultEl.className = 'result';

    callNativeMonteCarlo(ticker, currentPrice, annReturn, annVol, 252, 10000, model)
        .then(function(data) {
            // C service returns portfolio-level values. Convert to percentages
            // which are scale-independent and meaningful for any starting price.
            var meanFinal = data.mean_final_value || 0;
            var var95 = data.var_95 || 0;
            var var99 = data.var_99 || 0;
            var maxDD = data.max_drawdown || 0;
            var probProfit = data.prob_profit || 0;
            var calcUs = data.calc_time_us || 0;

            // Convert to per-share terms using ratio to starting price
            var avgReturn = ((meanFinal / currentPrice) - 1) * 100;
            var var95Pct = (var95 / currentPrice) * 100;
            var var99Pct = (var99 / currentPrice) * 100;
            var price95 = currentPrice * (1 - var95 / currentPrice);
            var price99 = currentPrice * (1 - var99 / currentPrice);

            // Build contextual hint when using another ticker's vol
            var volHint = '';
            if (volTicker !== ticker) {
                var INDICES = { SPY: 1, ACWI: 1, UUP: 1, DIA: 1, QQQ: 1, IVV: 1, VOO: 1,
                                EFA: 1, EEM: 1, AGG: 1, TLT: 1, GLD: 1 };
                var FX_CODES = ['USD','EUR','GBP','AUD','CHF','CNY','JPY','CAD','MXN',
                                'KRW','BRL','NOK','SEK','SGD','TWD','ZAR','INR','HKD'];
                var isFx = false;
                for (var f = 0; f < FX_CODES.length; f++) {
                    if (volTicker.indexOf(FX_CODES[f]) !== -1 && volTicker.length > 3) { isFx = true; break; }
                }
                var kind = isFx ? 'this currency pair' : (INDICES[volTicker] ? 'this index' : 'this equity');
                volHint = 'What would ' + ticker + ' do if it behaved like ' + kind + '?';
            }

            var lines = [
                ticker + ' Monte Carlo Simulation',
            ];
            if (volHint) lines.push(volHint);
            lines.push(
                '',
                'Step 1 — Measure from history:',
                '  Period: ' + lookbackStartDate + ' to ' + lookbackEndDate,
                '  Window: ' + lookbackLabel,
                '  Annualized return: ' + (annReturn * 100).toFixed(1) + '% / yr',
                '  Annualized volatility: ' + (annVol * 100).toFixed(1) + '% / yr',
                '',
                'Step 2 — Simulate forward:',
                '  Starting price: $' + currentPrice.toFixed(2) + ' (' + lookbackEndDate + ')',
                '  10,000 random price paths × 252 days each',
                '  (' + (model === 'merton' ? 'Merton jump-diffusion' : 'Geometric Brownian Motion') + ' in native C)',
                '',
                'Step 3 — Sort outcomes:',
                '',
                'Results across 10,000 simulated years:',
                '',
                '  Avg final price: $' + meanFinal.toFixed(2) +
                    ' (' + (avgReturn >= 0 ? '+' : '') + avgReturn.toFixed(1) + '%)',
                '  Profit in ' + (probProfit * 100).toFixed(0) + '% of simulations',
                '',
                '  95% VaR: $' + price95.toFixed(2) +
                    ' (' + var95Pct.toFixed(1) + '% loss)',
                '    → 9,500 of 10,000 paths ended above this price',
                '  99% VaR: $' + price99.toFixed(2) +
                    ' (' + var99Pct.toFixed(1) + '% loss)',
                '    → 9,900 of 10,000 paths ended above this price',
                '',
                '  Worst drawdown in any path: ' + (maxDD * 100).toFixed(1) + '%'
            );
            if (calcUs > 0) lines.push('  Native C: ' + (calcUs / 1000).toFixed(1) + ' ms');
            lines.push('');
            if (model === 'merton') {
                lines.push(
                    'Model: Merton (1976) jump-diffusion.',
                    '  Adds random crashes/gaps to GBM baseline.',
                    '  Defaults: ~1 jump/yr, avg −3%, ±5% size.',
                    '  Better tail risk than GBM; still assumes',
                    '  constant vol between jumps.',
                    '  VaR precision: ±1–2% SE at 10k sims.'
                );
            } else {
                lines.push(
                    'Caveats:',
                    '  GBM assumes constant vol and no jumps —',
                    '  understates real tail risk. Try Merton',
                    '  jump-diffusion for fatter tails.',
                    '  VaR precision: ±1–2% SE at 10k sims.',
                    '  100k would cut error ~3× (~1.3s on ARM).'
                );
            }
            resultEl.style.textAlign = 'left';
            resultEl.style.fontSize = '13px';
            resultEl.style.whiteSpace = 'pre-line';
            resultEl.textContent = lines.join('\n');
            resultEl.className = 'result positive';
        })
        .catch(function(e) {
            resultEl.textContent = 'Native service error: ' + e.message;
            resultEl.className = 'result negative';
            resultEl.style.fontSize = '13px';
        });
}

// Initialize scenario table with 3 default rows on load
document.addEventListener('DOMContentLoaded', function() {
    var tbody = document.getElementById('scenario-rows');
    if (!tbody) return;
    // Values are multiples of the current price, so the defaults stay
    // plausible whichever ticker is picked; updateScenarioCurrentPrice
    // rescales them until the user types over one.
    var defaults = [
        { label: 'Bull', prob: 25, mult: 1.3 },
        { label: 'Base', prob: 50, mult: 1.05 },
        { label: 'Bear', prob: 25, mult: 0.7 }
    ];
    var price = parseFloat(document.getElementById('scenario-current-price').value) || 100;
    for (var i = 0; i < defaults.length; i++) {
        var d = defaults[i];
        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td><input type="text" class="scenario-label" maxlength="32" value="' + d.label + '" style="width:80px"></td>' +
            '<td><input type="number" class="scenario-prob" step="1" min="0" max="100" value="' + d.prob + '" style="width:60px" onchange="validateScenarioProbs()">%</td>' +
            '<td><input type="number" class="scenario-value" step="0.01" value="' + (price * d.mult).toFixed(2) +
                '" data-mult="' + d.mult + '" oninput="delete this.dataset.mult" style="width:80px"></td>' +
            '<td><button class="remove-row-btn" onclick="this.closest(\'tr\').remove();validateScenarioProbs()">×</button></td>';
        tbody.appendChild(tr);
    }
    validateScenarioProbs();
});
