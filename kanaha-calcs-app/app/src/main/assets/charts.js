// kanaha-calcs: Chart.js chart creation functions
// All charts use data from appData (loaded by data.js).

/*
 * Chart.js global defaults — set once, apply to all charts.
 * These mutate a global singleton (Chart.defaults), which is the
 * Chart.js-idiomatic way to theme. Unlike CSS, chart canvas elements
 * don't inherit styles from the DOM — everything must be set via JS.
 */
Chart.defaults.color = '#e0e0e0';
Chart.defaults.borderColor = '#2a2a4a';
Chart.defaults.font.family = "-apple-system, 'Segoe UI', Roboto, sans-serif";

/*
 * Chart.js leaks GPU memory if you create a new chart on a canvas that
 * already has one. Must explicitly destroy() the old instance first.
 * This is like closing a file descriptor before reopening — no GC help.
 */
var chartInstances = {};

function destroyChart(canvasId) {
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
        delete chartInstances[canvasId];
    }
}

// Accent colors for multi-line charts
var CHART_COLORS = [
    '#00d4aa', '#ff6b6b', '#4ecdc4', '#ffd93d', '#6c5ce7',
    '#a8e6cf', '#ff8a5c', '#ea8685', '#778beb', '#f3a683'
];

/**
 * Price history chart — multi-line, one per ticker.
 */
function renderPriceHistory() {
    if (!appData.loaded) return;
    var canvasId = 'chart-price-history';
    destroyChart(canvasId);

    var checkboxes = document.querySelectorAll('#price-tickers input[type=checkbox]:checked');
    var tickers = [];
    for (var i = 0; i < checkboxes.length; i++) tickers.push(checkboxes[i].value);
    if (tickers.length === 0) return;

    // Subsample to ~500 points. Chart.js renders every point as a path
    // segment on a <canvas> — 4000+ points causes visible jank on mobile
    // WebView. 500 points is visually indistinguishable from full resolution
    // on a phone screen. pointRadius: 0 below also helps (no dot per point).
    var step = Math.max(1, Math.floor(appData.dates.length / 500));
    var labels = [];
    var datasets = [];

    for (var t = 0; t < tickers.length; t++) {
        var data = [];
        var prices = appData.adjClose[tickers[t]];
        for (var i = 0; i < appData.dates.length; i += step) {
            if (t === 0) labels.push(appData.dates[i]);
            data.push(prices[i]);
        }
        datasets.push({
            label: tickers[t],
            data: data,
            borderColor: CHART_COLORS[t % CHART_COLORS.length],
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.1
        });
    }

    var ctx = document.getElementById(canvasId).getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12 } }
            },
            scales: {
                x: {
                    ticks: { maxTicksLimit: 8, maxRotation: 0 }
                },
                y: {
                    title: { display: true, text: 'Adj. Close ($)' }
                }
            }
        }
    });
}

/**
 * Drawdown chart — single ticker, filled area below zero.
 */
function renderDrawdown() {
    if (!appData.loaded) return;
    var canvasId = 'chart-drawdown';
    destroyChart(canvasId);

    var ticker = document.getElementById('chart-dd-ticker').value;
    var prices = appData.adjClose[ticker];
    if (!prices) return;

    var step = Math.max(1, Math.floor(prices.length / 500));
    var labels = [];
    var data = [];
    var peak = prices[0];

    for (var i = 0; i < prices.length; i += step) {
        if (prices[i] > peak) peak = prices[i];
        labels.push(appData.dates[i]);
        data.push(((prices[i] - peak) / peak) * 100);
    }

    var ctx = document.getElementById(canvasId).getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: ticker + ' Drawdown (%)',
                data: data,
                borderColor: '#ff6b6b',
                backgroundColor: 'rgba(255, 107, 107, 0.15)',
                fill: true,
                borderWidth: 1.5,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } },
                y: { title: { display: true, text: 'Drawdown (%)' } }
            }
        }
    });
}

/**
 * Dividend timeline — bar chart of ex-dividend amounts.
 */
function renderDividendTimeline() {
    if (!appData.loaded) return;
    var canvasId = 'chart-dividends';
    destroyChart(canvasId);

    var ticker = document.getElementById('chart-div-ticker').value;
    var divs = appData.exDiv[ticker];
    if (!divs) return;

    // Filter to non-zero dividends only
    var labels = [];
    var data = [];
    for (var i = 0; i < divs.length; i++) {
        if (divs[i] > 0) {
            labels.push(appData.dates[i]);
            data.push(divs[i]);
        }
    }

    if (data.length === 0) {
        var ctx = document.getElementById(canvasId).getContext('2d');
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = '#8888aa';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ticker + ' paid no dividends in this period', ctx.canvas.width / 2, 80);
        return;
    }

    var ctx = document.getElementById(canvasId).getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: ticker + ' Ex-Dividend ($)',
                data: data,
                backgroundColor: '#00d4aa',
                borderRadius: 2
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { maxTicksLimit: 10, maxRotation: 45 } },
                y: { title: { display: true, text: 'Dividend ($)' } }
            }
        }
    });
}

/*
 * Volatility bars — horizontal bar chart comparing annualized vols.
 * Recomputes vol inline rather than caching because the ticker set can
 * change when user loads new CSV data. The sqrt(variance * 252) formula
 * is the same annualization used in fund.js and calcs.js.
 */
function renderVolatilityBars() {
    if (!appData.loaded) return;
    var canvasId = 'chart-volatility';
    destroyChart(canvasId);

    var tickers = appData.tickers;
    var vols = [];
    for (var i = 0; i < tickers.length; i++) {
        var rets = logReturns(tickers[i]);
        if (rets.length < 2) { vols.push(0); continue; }
        var mean = 0;
        for (var j = 0; j < rets.length; j++) mean += rets[j];
        mean /= rets.length;
        var variance = 0;
        for (var j = 0; j < rets.length; j++) {
            var d = rets[j] - mean;
            variance += d * d;
        }
        variance /= (rets.length - 1);
        vols.push(Math.sqrt(variance * 252) * 100);
    }

    var ctx = document.getElementById(canvasId).getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: tickers,
            datasets: [{
                label: 'Annualized Volatility (%)',
                data: vols,
                backgroundColor: CHART_COLORS.slice(0, tickers.length),
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: 'Volatility (%)' } }
            }
        }
    });
}

/*
 * Correlation heatmap — drawn directly on <canvas> 2D context, not Chart.js.
 * Chart.js has no built-in heatmap type, so we do manual pixel-level drawing.
 * This is essentially the same as writing to a framebuffer in C: fillRect()
 * for cells, fillText() for labels, explicit coordinate math for layout.
 * Color interpolation: negative correlation -> red, zero -> dark bg, positive -> green.
 */
function renderCorrelationHeatmap() {
    if (!appData.loaded) return;
    var tickers = appData.tickers;
    if (tickers.length < 2) return;

    var matrix = covarianceMatrix(tickers);
    if (!matrix) return;

    // Convert to correlation
    var corr = [];
    for (var i = 0; i < tickers.length; i++) {
        corr[i] = [];
        for (var j = 0; j < tickers.length; j++) {
            corr[i][j] = matrix[i][j] / Math.sqrt(matrix[i][i] * matrix[j][j]);
        }
    }

    var canvas = document.getElementById('chart-correlation');
    var ctx = canvas.getContext('2d');
    var n = tickers.length;
    var cellSize = Math.min(60, Math.floor((canvas.width - 60) / n));
    var offsetX = 60;
    var offsetY = 30;

    canvas.height = offsetY + n * cellSize + 20;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw cells
    for (var i = 0; i < n; i++) {
        for (var j = 0; j < n; j++) {
            var val = corr[i][j];
            // Interpolate: -1 → negative red, 0 → dark bg, 1 → accent green
            var r, g, b;
            if (val >= 0) {
                var t = val;
                r = Math.round(26 * (1 - t) + 0 * t);
                g = Math.round(26 * (1 - t) + 212 * t);
                b = Math.round(46 * (1 - t) + 170 * t);
            } else {
                var t = -val;
                r = Math.round(26 * (1 - t) + 255 * t);
                g = Math.round(26 * (1 - t) + 107 * t);
                b = Math.round(46 * (1 - t) + 107 * t);
            }
            ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
            ctx.fillRect(offsetX + j * cellSize, offsetY + i * cellSize, cellSize - 1, cellSize - 1);

            // Flip text color for contrast: dark text on bright cells, light on dark
            ctx.fillStyle = Math.abs(val) > 0.5 ? '#1a1a2e' : '#e0e0e0';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(val.toFixed(2),
                offsetX + j * cellSize + cellSize / 2,
                offsetY + i * cellSize + cellSize / 2 + 4);
        }
    }

    // Row labels (left)
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    for (var i = 0; i < n; i++) {
        ctx.fillText(tickers[i], offsetX - 6, offsetY + i * cellSize + cellSize / 2 + 4);
    }

    // Column labels (top)
    ctx.textAlign = 'center';
    for (var j = 0; j < n; j++) {
        ctx.fillText(tickers[j], offsetX + j * cellSize + cellSize / 2, offsetY - 8);
    }
}

/*
 * Raw vs Adjusted price chart — dual-line overlay showing split/dividend effects.
 * The gap between raw Close and Adj Close grows over time because Adj Close
 * retroactively reduces historical prices for each split and dividend.
 * A stock that split 7:1 (like AAPL in 2014) will show raw close ~7x higher
 * than adj close for pre-split dates. This chart makes that visible.
 */
function renderRawVsAdjusted() {
    if (!appData.loaded) return;
    var canvasId = 'chart-raw-adj';
    destroyChart(canvasId);

    var ticker = document.getElementById('chart-rawadj-ticker').value;
    var rawPrices = appData.close[ticker];
    var adjPrices = appData.adjClose[ticker];
    if (!rawPrices || !adjPrices) return;

    var step = Math.max(1, Math.floor(appData.dates.length / 500));
    var labels = [];
    var rawData = [];
    var adjData = [];

    for (var i = 0; i < appData.dates.length; i += step) {
        labels.push(appData.dates[i]);
        rawData.push(rawPrices[i]);
        adjData.push(adjPrices[i]);
    }

    var ctx = document.getElementById(canvasId).getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: ticker + ' Close (raw)',
                    data: rawData,
                    borderColor: '#ff6b6b',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: 0
                },
                {
                    label: ticker + ' Adj. Close',
                    data: adjData,
                    borderColor: '#00d4aa',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12 } }
            },
            scales: {
                x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } },
                y: { title: { display: true, text: 'Price ($)' } }
            }
        }
    });
}
