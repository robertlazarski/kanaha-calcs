// kanaha-calcs: CSV parser and data management
// Loads bundled sample data on startup, supports user CSV via file picker.

/*
 * Global data store. JS has no struct keyword — this object literal is the
 * closest equivalent. All properties are mutable (no const enforcement in
 * older WebView JS engines). adjClose vs close matters: adjClose is
 * retroactively corrected for splits/dividends, so log returns computed
 * from adjClose reflect true economic returns. Raw close is kept for the
 * Raw vs Adjusted chart overlay.
 */
/*
 * Split a ticker list into equities, indices and currency pairs.
 *
 * FX tickers contain a currency code and are longer than three characters;
 * known index ETFs are listed; everything else is an equity. The rule lives
 * here rather than inside the UI builder because the fund tab needs the same
 * answer when it seeds a starting book, and two copies of a rule like this one
 * drift the first time an unfamiliar ticker arrives in an uploaded file.
 */
function classifyTickers(tickers) {
    var INDICES = { SPY: 1, ACWI: 1, UUP: 1, DIA: 1, QQQ: 1, IVV: 1, VOO: 1,
                    EFA: 1, EEM: 1, AGG: 1, TLT: 1, GLD: 1 };
    var FX_CODES = ['USD','EUR','GBP','AUD','CHF','CNY','JPY','CAD','MXN',
                    'KRW','BRL','NOK','SEK','SGD','TWD','ZAR','INR','HKD'];
    var grouped = { equities: [], indices: [], fx: [] };
    for (var t = 0; t < tickers.length; t++) {
        var tk = tickers[t];
        var isFx = false;
        for (var f = 0; f < FX_CODES.length; f++) {
            if (tk.indexOf(FX_CODES[f]) !== -1 && tk.length > 3) { isFx = true; break; }
        }
        if (isFx) { grouped.fx.push(tk); }
        else if (INDICES[tk]) { grouped.indices.push(tk); }
        else { grouped.equities.push(tk); }
    }
    return grouped;
}

var appData = {
    dates: [],       // ['2008-03-28', ...]
    tickers: [],     // ['MSFT', 'AAPL', ...]
    adjClose: {},    // { MSFT: [21.84, 22.21, ...], ... }
    close: {},       // { MSFT: [27.91, 28.38, ...], ... } (raw close)
    exDiv: {},       // { MSFT: [0, 0, 0.11, ...], ... }
    split: {},       // { MSFT: [1, 1, 7, ...], ... }
    loaded: false,
    source: ''       // 'bundled' or filename
};

/**
 * Parse CSV text with TICKER_Field column naming convention.
 * Groups columns by ticker prefix, extracts AdjClose/Close/ExDiv/Split.
 */
function parseCSV(text) {
    var lines = text.trim().split('\n');
    if (lines.length < 2) return null;

    var headers = lines[0].split(',');
    var dates = [];
    var tickerSet = {};
    var adjClose = {};
    var close = {};
    var exDiv = {};
    var split = {};

    // Discover tickers by splitting on underscore: "MSFT_AdjClose" -> ticker "MSFT".
    // tickerSet is used as a poor man's Set (JS objects are hash maps — O(1) lookup).
    var colMap = {}; // { 'MSFT_AdjClose': colIndex, ... }
    for (var c = 1; c < headers.length; c++) {
        var h = headers[c].trim();
        colMap[h] = c;
        var parts = h.split('_');
        if (parts.length >= 2) {
            tickerSet[parts[0]] = true;
        }
    }

    var tickers = Object.keys(tickerSet).sort();

    // Initialize arrays
    for (var t = 0; t < tickers.length; t++) {
        adjClose[tickers[t]] = [];
        close[tickers[t]] = [];
        exDiv[tickers[t]] = [];
        split[tickers[t]] = [];
    }

    // Parse rows
    for (var r = 1; r < lines.length; r++) {
        var row = lines[r].split(',');
        if (row.length < 2) continue;
        dates.push(row[0].trim());

        for (var t = 0; t < tickers.length; t++) {
            var tk = tickers[t];
            var ac = colMap[tk + '_AdjClose'];
            var cl = colMap[tk + '_Close'];
            var ed = colMap[tk + '_ExDiv'];
            var sp = colMap[tk + '_Split'];

            adjClose[tk].push(ac !== undefined ? parseFloat(row[ac]) : NaN);
            close[tk].push(cl !== undefined ? parseFloat(row[cl]) : NaN);
            exDiv[tk].push(ed !== undefined ? parseFloat(row[ed]) : NaN);
            split[tk].push(sp !== undefined ? parseFloat(row[sp]) : NaN);
        }
    }

    // Fallback for simple CSVs (e.g. Date,MSFT,AAPL with no _AdjClose suffix).
    // Treats each column as adjClose and synthesizes zero dividends / no splits.
    if (tickers.length === 0) {
        for (var c = 1; c < headers.length; c++) {
            var ticker = headers[c].trim();
            tickers.push(ticker);
            adjClose[ticker] = [];
            close[ticker] = [];
            exDiv[ticker] = [];
            split[ticker] = [];
        }
        for (var r = 1; r < lines.length; r++) {
            var row = lines[r].split(',');
            if (row.length < 2) continue;
            if (tickers.length > 0 && dates.length < r) dates.push(row[0].trim());
            for (var c = 1; c < headers.length && c < row.length; c++) {
                var ticker = headers[c].trim();
                var val = parseFloat(row[c]);
                adjClose[ticker].push(val);
                close[ticker].push(val);
                exDiv[ticker].push(0);
                split[ticker].push(1);
            }
        }
    }

    return { dates: dates, tickers: tickers, adjClose: adjClose, close: close,
             exDiv: exDiv, split: split };
}

/*
 * Load bundled sample data on startup.
 * ANDROID WEBVIEW GOTCHA: fetch() on file:// URLs is broken in many WebView
 * versions (returns opaque response or throws TypeError). XMLHttpRequest works
 * reliably because it predates CORS and treats file:// as same-origin.
 * The status === 0 check handles file:// (no HTTP status code on local reads).
 */
/*
 * Load the bundled dataset, preferring a vendor file when present and
 * falling back to the public-domain Quandl WIKI data otherwise.
 *
 * vendor_daily_closes.csv is data you license yourself and place in
 * sample_data/ for a local build; it is gitignored and never shipped from this
 * repository. A clean checkout does not have it, so the app would otherwise
 * load nothing. wiki_2008_2018_daily_closes.csv is public-domain, tracked, and always
 * present. On file:// a missing candidate fires onerror (or onload with an
 * empty body); either way we advance to the next path.
 *
 * The WIKI file is a HISTORICAL dataset, not a stale one: its source was
 * dedicated to the public domain and frozen at 2018-03-27, so 2008-2018 is
 * the whole of what may be redistributed, and it will never grow. Do not
 * rename it back to anything that hides the era -- the dates are the point,
 * and both a reader and the MCP orchestrator pick a file by its name.
 * Numbers from it describe that decade, including the 2008 crisis, and are
 * not a current risk estimate for any book.
 */
function loadBundledData() {
    loadCSVWithFallback([
        'sample_data/vendor_daily_closes.csv',
        'sample_data/wiki_2008_2018_daily_closes.csv'
    ], 0);
}

function loadCSVWithFallback(paths, idx) {
    if (idx >= paths.length) {
        updateDataStatus('Failed to load bundled data', true);
        return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', paths[idx], true);
    xhr.onload = function() {
        if (xhr.status === 0 || xhr.status === 200) {
            var parsed = parseCSV(xhr.responseText);
            if (parsed && parsed.tickers.length > 0) {
                appData.dates = parsed.dates;
                appData.tickers = parsed.tickers;
                appData.adjClose = parsed.adjClose;
                appData.close = parsed.close;
                appData.exDiv = parsed.exDiv;
                appData.split = parsed.split;
                appData.loaded = true;
                appData.source = 'bundled';
                console.log('kanaha-calcs: loaded ' + paths[idx] +
                            ' (' + parsed.tickers.length + ' tickers)');
                onDataLoaded();
            } else {
                loadCSVWithFallback(paths, idx + 1);
            }
        } else {
            loadCSVWithFallback(paths, idx + 1);
        }
    };
    xhr.onerror = function() {
        loadCSVWithFallback(paths, idx + 1);
    };
    xhr.send();
}

function updateDataStatus(msg, isError) {
    var el = document.getElementById('data-status');
    if (el) {
        el.textContent = msg;
        el.style.color = isError ? 'var(--negative)' : 'var(--accent)';
    }
}

/*
 * Called from Java via evaluateJavascript() with Base64-encoded args.
 * Why Base64: if raw CSV content were string-interpolated into JS, a
 * malicious filename or CSV cell like '); alert('xss could execute
 * arbitrary code in the WebView. Base64 guarantees the payload is
 * alphanumeric — same principle as parameterized SQL vs string concat.
 */
function receiveCSVBase64(b64Content, b64Filename) {
    var content = atob(b64Content);
    var filename = atob(b64Filename);
    receiveCSV(content, filename);
}

/**
 * Called when CSV content is available (from Java or browser file picker).
 */
function receiveCSV(content, filename) {
    var parsed = parseCSV(content);
    if (parsed && parsed.tickers.length > 0) {
        appData.dates = parsed.dates;
        appData.tickers = parsed.tickers;
        appData.adjClose = parsed.adjClose;
        appData.close = parsed.close;
        appData.exDiv = parsed.exDiv;
        appData.split = parsed.split;
        appData.loaded = true;
        appData.source = filename || 'user';
        onDataLoaded();
    }
}

/**
 * Update UI after data loads — populate ticker dropdowns, show status.
 */
function onDataLoaded() {
    var n = appData.dates.length;
    var first = appData.dates[0];
    var last = appData.dates[n - 1];

    // Classify tickers into groups before building any UI.
    var grouped = classifyTickers(appData.tickers);
    var groupOrder = [
        { label: 'Equities', tickers: grouped.equities },
        { label: 'Indices', tickers: grouped.indices },
        { label: 'Currencies', tickers: grouped.fx }
    ];

    // Update status bar (compact — just count and date range)
    var status = document.getElementById('data-status');
    if (status) {
        status.textContent = appData.tickers.length + ' tickers \u2014 ' +
            first + ' to ' + last;
        status.style.color = 'var(--accent)';
    }

    // Update data context card with grouped tickers — use textContent (not
    // innerHTML) to prevent XSS from malicious filenames
    var ctx = document.getElementById('data-context');
    if (ctx) {
        ctx.textContent = '';
        var sourceLabel = appData.source === 'bundled'
            ? 'Bundled dataset'
            : appData.source;

        // Source + Period
        var details = [
            ['Source', sourceLabel],
            ['Period', first + ' to ' + last + ' (' + n + ' trading days)']
        ];
        for (var i = 0; i < details.length; i++) {
            var div = document.createElement('div');
            div.className = 'data-context-detail';
            var strong = document.createElement('strong');
            strong.textContent = details[i][0] + ': ';
            div.appendChild(strong);
            div.appendChild(document.createTextNode(details[i][1]));
            ctx.appendChild(div);
        }

        // Grouped ticker display
        for (var g = 0; g < groupOrder.length; g++) {
            var grp = groupOrder[g];
            if (grp.tickers.length === 0) continue;
            var div = document.createElement('div');
            div.className = 'data-context-detail';
            var strong = document.createElement('strong');
            strong.textContent = grp.label + ': ';
            div.appendChild(strong);
            div.appendChild(document.createTextNode(grp.tickers.join(', ')));
            ctx.appendChild(div);
        }

        if (appData.source === 'bundled') {
            var hint = document.createElement('div');
            hint.className = 'data-context-detail';
            hint.style.marginTop = '6px';
            hint.style.fontSize = '12px';
            hint.style.color = 'var(--text-muted)';
            hint.textContent = 'Data-driven calculators below operate on this dataset. Manual-entry calculators (Kelly, Sharpe, etc.) use your inputs only.';
            ctx.appendChild(hint);
        }
    }

    // Populate all ticker dropdowns with <optgroup> sections
    var selects = document.querySelectorAll('.ticker-select');
    for (var s = 0; s < selects.length; s++) {
        var sel = selects[s];
        sel.innerHTML = '';
        for (var g = 0; g < groupOrder.length; g++) {
            var grp = groupOrder[g];
            if (grp.tickers.length === 0) continue;
            var optgroup = document.createElement('optgroup');
            optgroup.label = grp.label;
            for (var t = 0; t < grp.tickers.length; t++) {
                var opt = document.createElement('option');
                opt.value = grp.tickers[t];
                opt.textContent = grp.tickers[t];
                optgroup.appendChild(opt);
            }
            sel.appendChild(optgroup);
        }
    }

    // Populate Monte Carlo "Use another ticker's characteristics" optgroup
    var mcVolGroup = document.getElementById('mc-vol-tickers');
    if (mcVolGroup) {
        mcVolGroup.innerHTML = '';
        for (var t = 0; t < appData.tickers.length; t++) {
            var opt = document.createElement('option');
            opt.value = 'ticker:' + appData.tickers[t];
            opt.textContent = appData.tickers[t];
            mcVolGroup.appendChild(opt);
        }
    }

    // Auto-fill scenario current price from first ticker
    if (typeof updateScenarioCurrentPrice === 'function') {
        updateScenarioCurrentPrice();
    }

    // Populate multi-select ticker checkboxes with group headers
    var checkGroups = document.querySelectorAll('.ticker-checkboxes');
    for (var cg = 0; cg < checkGroups.length; cg++) {
        var container = checkGroups[cg];
        container.innerHTML = '';
        for (var g = 0; g < groupOrder.length; g++) {
            var grp = groupOrder[g];
            if (grp.tickers.length === 0) continue;
            // Group header
            var header = document.createElement('div');
            header.className = 'ticker-group-header';
            header.textContent = grp.label;
            container.appendChild(header);
            // Checkboxes
            for (var t = 0; t < grp.tickers.length; t++) {
                var label = document.createElement('label');
                label.style.marginRight = '12px';
                label.style.fontSize = '14px';
                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = grp.tickers[t];
                // Default: equities checked, indices checked, FX unchecked
                cb.checked = grp.label !== 'Currencies';
                cb.style.marginRight = '4px';
                label.appendChild(cb);
                label.appendChild(document.createTextNode(grp.tickers[t]));
                container.appendChild(label);
            }
        }
    }
}

/*
 * Log returns: ln(P_t / P_{t-1}). Used instead of arithmetic returns
 * ((P_t - P_{t-1}) / P_{t-1}) because log returns are time-additive:
 * the multi-day return is the sum of daily log returns. This matters
 * for annualization and portfolio aggregation. Arithmetic returns
 * require compounding ((1+r1)*(1+r2)-1), which is error-prone.
 * The guard against non-positive prices prevents NaN from log(0).
 */
function logReturns(ticker) {
    var prices = appData.adjClose[ticker];
    if (!prices || prices.length < 2) return [];
    var ret = [];
    for (var i = 1; i < prices.length; i++) {
        if (prices[i] > 0 && prices[i - 1] > 0) {
            ret.push(Math.log(prices[i] / prices[i - 1]));
        } else {
            ret.push(0);
        }
    }
    return ret;
}

/*
 * Monthly resampling: take last trading day of each month.
 * Detects month boundaries by comparing YYYY-MM prefixes.
 * Financial convention: month-end prices are the standard for monthly
 * return calculations to avoid intra-month noise.
 */
function monthlyResample(dates, values) {
    if (dates.length === 0) return { dates: [], values: [] };
    var outDates = [];
    var outValues = [];
    var prevMonth = dates[0].substring(0, 7);
    var lastIdx = 0;

    for (var i = 1; i < dates.length; i++) {
        var month = dates[i].substring(0, 7);
        if (month !== prevMonth) {
            outDates.push(dates[lastIdx]);
            outValues.push(values[lastIdx]);
            prevMonth = month;
        }
        lastIdx = i;
    }
    // Last data point
    outDates.push(dates[lastIdx]);
    outValues.push(values[lastIdx]);
    return { dates: outDates, values: outValues };
}

// Auto-load bundled data when page loads
document.addEventListener('DOMContentLoaded', loadBundledData);
