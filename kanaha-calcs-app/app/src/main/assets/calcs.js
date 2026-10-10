// kanaha-calcs: Pure calculation functions + DOM wiring
// All formulas implemented from cited academic papers only.

// --- Calculation Functions ---

/*
 * Kelly Fraction: f* = (b*p - q) / b
 * Kelly (1956), Bell System Technical Journal, 35(4): 917-926.
 * Returns the optimal fraction of capital to bet. Values > 1 mean
 * leverage; negative means the bet has negative expected value.
 * Production portfolio sizing tools use variants of this formula.
 */
function kellyFraction(p, b) {
    var q = 1 - p;
    return (b * p - q) / b;
}

/** Kelly Odds (Payoff Ratio): odds = |reward| / |risk|
 *  Kelly (1956), Section III. */
function kellyOdds(reward, risk) {
    if (risk === 0) return Infinity;
    return Math.abs(reward) / Math.abs(risk);
}

/** Sharpe Ratio: SR = (R_p - R_f) / sigma_p
 *  Sharpe (1966), Journal of Business, 39(1): 119-138. */
function sharpeRatio(ret, rf, vol) {
    if (vol === 0) return 0;
    return (ret - rf) / vol;
}

/*
 * Normal CDF using Abramowitz & Stegun 26.2.17 rational approximation.
 * Abramowitz & Stegun (1964), Handbook of Mathematical Functions, NBS.
 *
 * Why not erf(): Math.erf() doesn't exist in JS. This polynomial
 * approximation has max absolute error < 1.5e-7, which is more than
 * adequate for financial probability estimates. The early returns at
 * +/-8 clamp the tails (8 sigma events are ~6e-16 probability).
 * The Horner-form polynomial evaluation (nested multiply-add) is the
 * same optimization you'd use in C — minimizes floating point ops.
 */
function normalCDF(x) {
    if (x < -8) return 0;
    if (x > 8) return 1;
    var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1.0 / (1.0 + p * x);
    var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
    return 0.5 * (1.0 + sign * y);
}

/** Percent Change: (new - old) / old * 100
 *  Fibonacci (1202), Liber Abaci. */
function percentChange(oldVal, newVal) {
    if (oldVal === 0) return Infinity;
    return (newVal - oldVal) / oldVal * 100;
}

/*
 * Median: sort, take middle value.
 * Galton (1881), Report of the Anthropometric Committee.
 * JS GOTCHA: Array.sort() without a comparator sorts lexicographically
 * ("10" < "9"), so the explicit (a, b) => a - b is mandatory for numbers.
 * arr.slice() copies to avoid mutating the caller's array (JS arrays are
 * reference types, like Java arrays — no implicit copy-on-write).
 */
function median(arr) {
    if (arr.length === 0) return NaN;
    var sorted = arr.slice().sort(function(a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/*
 * Covariance matrix from daily log returns, annualized by multiplying x252.
 * Pearson (1896), Phil. Trans. Royal Society A, 187: 253-318.
 *
 * Why 252: US equity markets have ~252 trading days/year. Daily variance
 * scales linearly with time horizon under i.i.d. assumption, so
 * annualized_variance = daily_variance * 252. This is the standard
 * convention across portfolio systems. Uses (n-1) denominator
 * (Bessel's correction) for unbiased sample covariance.
 *
 * Perf note: O(n * k^2) where k = tickers, n = trading days. Fine for
 * < 20 tickers; the Axis2/C path handles larger matrices.
 */
function covarianceMatrix(tickers) {
    var returns = {};
    var n = Infinity;
    for (var i = 0; i < tickers.length; i++) {
        returns[tickers[i]] = logReturns(tickers[i]);
        n = Math.min(n, returns[tickers[i]].length);
    }
    if (n < 2) return null;

    // Compute means
    var means = {};
    for (var i = 0; i < tickers.length; i++) {
        var sum = 0;
        for (var d = 0; d < n; d++) sum += returns[tickers[i]][d];
        means[tickers[i]] = sum / n;
    }

    // Compute covariance
    var matrix = [];
    for (var i = 0; i < tickers.length; i++) {
        matrix[i] = [];
        for (var j = 0; j < tickers.length; j++) {
            var cov = 0;
            for (var d = 0; d < n; d++) {
                cov += (returns[tickers[i]][d] - means[tickers[i]]) *
                       (returns[tickers[j]][d] - means[tickers[j]]);
            }
            matrix[i][j] = (cov / (n - 1)) * 252; // annualize
        }
    }
    return matrix;
}

/*
 * Maximum Drawdown: largest peak-to-trough decline as a fraction.
 * Grossman & Zhou (1993), Mathematical Finance, 3(3): 241-276.
 * Returns a negative number (e.g., -0.55 = 55% drawdown). Single pass
 * O(n) — tracks running peak, same algorithm you'd write in C.
 */
function maxDrawdown(prices) {
    if (prices.length < 2) return 0;
    var peak = prices[0];
    var maxDD = 0;
    for (var i = 1; i < prices.length; i++) {
        if (prices[i] > peak) peak = prices[i];
        var dd = (prices[i] - peak) / peak;
        if (dd < maxDD) maxDD = dd;
    }
    return maxDD; // negative number
}

/** NAV: sum of (price * quantity).
 *  Pacioli (1494), Summa de Arithmetica. */
function nav(prices, quantities) {
    var total = 0;
    for (var i = 0; i < prices.length; i++) {
        total += prices[i] * quantities[i];
    }
    return total;
}

/** Portfolio Weight: value_i / NAV.
 *  Markowitz (1952), Journal of Finance, 7(1): 77-91. */
function portfolioWeight(value, totalNAV) {
    if (totalNAV === 0) return 0;
    return value / totalNAV;
}

/** Portfolio Return: weighted sum of individual returns.
 *  Markowitz (1952), same paper. */
function portfolioReturn(weights, returns) {
    var total = 0;
    for (var i = 0; i < weights.length; i++) {
        total += weights[i] * returns[i];
    }
    return total;
}

/** Excess Return vs benchmark.
 *  Jensen (1968), Journal of Finance, 23(2): 389-416. */
function excessReturn(portfolioRet, benchmarkRet) {
    return portfolioRet - benchmarkRet;
}

/*
 * Dividend Yield: trailing 4 quarterly dividends / price * 100.
 * Williams (1938), The Theory of Investment Value.
 * Uses last 4 non-zero ex-dividend amounts as a proxy for trailing
 * 12-month dividends (most US equities pay quarterly). This is a
 * simplification — real TTM yield requires calendar-aware grouping.
 */
function dividendYield(exDivs, price) {
    // Sum last 4 non-zero dividends
    var divs = exDivs.filter(function(d) { return d > 0; });
    var trailing = divs.slice(-4);
    var total = 0;
    for (var i = 0; i < trailing.length; i++) total += trailing[i];
    if (price <= 0) return 0;
    return (total / price) * 100;
}

/*
 * Information Ratio: mean(excess returns) / stdev(excess returns).
 * Grinold (1989), Journal of Portfolio Management, 15(3): 30-37.
 * This returns the daily IR — caller must multiply by sqrt(252) to
 * annualize. The sqrt scaling comes from stdev scaling with sqrt(T),
 * so IR_annual = IR_daily * sqrt(252). See fund.js line ~157.
 */
function informationRatio(excessReturns) {
    if (excessReturns.length < 2) return 0;
    var mean = 0;
    for (var i = 0; i < excessReturns.length; i++) mean += excessReturns[i];
    mean /= excessReturns.length;
    var variance = 0;
    for (var i = 0; i < excessReturns.length; i++) {
        var diff = excessReturns[i] - mean;
        variance += diff * diff;
    }
    variance /= (excessReturns.length - 1);
    var std = Math.sqrt(variance);
    if (std === 0) return 0;
    return mean / std;
}

/** Return Decomposition: R_local = R_total_USD - R_fx.
 *  Brinson, Hood & Beebower (1986), Financial Analysts Journal, 42(4): 39-44.
 *  Karnosky & Singer (1994), Global Asset Management.
 *  Given total USD return and FX return, derives local-currency return. */
function returnDecomposition(totalUsdReturn, fxReturn) {
    return { total: totalUsdReturn, local: totalUsdReturn - fxReturn, fx: fxReturn };
}

// --- DOM Wiring ---

function formatResult(value) {
    if (!isFinite(value)) return '—';
    // Show up to 4 decimal places, trim trailing zeros
    return parseFloat(value.toFixed(4)).toString();
}

function showResult(elementId, value) {
    var el = document.getElementById(elementId);
    var formatted = formatResult(value);
    el.textContent = formatted;
    el.className = 'result';
    if (isFinite(value)) {
        el.classList.add(value >= 0 ? 'positive' : 'negative');
    }
}

function calcKellyFraction() {
    var p = parseFloat(document.getElementById('kelly-p').value);
    var b = parseFloat(document.getElementById('kelly-b').value);
    if (isNaN(p) || isNaN(b)) return;
    showResult('kelly-result', kellyFraction(p, b));
}

function calcKellyOdds() {
    var reward = parseFloat(document.getElementById('odds-reward').value);
    var risk = parseFloat(document.getElementById('odds-risk').value);
    if (isNaN(reward) || isNaN(risk)) return;
    showResult('odds-result', kellyOdds(reward, risk));
}

function calcSharpe() {
    var ret = parseFloat(document.getElementById('sharpe-ret').value);
    var rf = parseFloat(document.getElementById('sharpe-rf').value);
    var vol = parseFloat(document.getElementById('sharpe-vol').value);
    if (isNaN(ret) || isNaN(rf) || isNaN(vol)) return;
    showResult('sharpe-result', sharpeRatio(ret, rf, vol));
}

// --- Data-Driven Calculator Wiring ---

function calcNormalCDF() {
    var ret = parseFloat(document.getElementById('norm-return').value);
    var vol = parseFloat(document.getElementById('norm-vol').value);
    if (isNaN(ret) || isNaN(vol) || vol === 0) return;
    var z = ret / vol;
    var prob = normalCDF(z);
    showResult('norm-result', prob);
    document.getElementById('norm-z').textContent = 'z = ' + z.toFixed(4);
}

function calcPercentChange() {
    var oldVal = parseFloat(document.getElementById('pct-old').value);
    var newVal = parseFloat(document.getElementById('pct-new').value);
    if (isNaN(oldVal) || isNaN(newVal)) return;
    var result = percentChange(oldVal, newVal);
    showResult('pct-result', result);
    document.getElementById('pct-result').textContent = formatResult(result) + '%';
}

function calcMaxDrawdown() {
    if (!appData.loaded) return;
    var ticker = document.getElementById('dd-ticker').value;
    var prices = appData.adjClose[ticker];
    if (!prices) return;
    var dd = maxDrawdown(prices);
    showResult('dd-result', dd * 100);
    document.getElementById('dd-result').textContent = formatResult(dd * 100) + '%';
}

function calcDividendYield() {
    if (!appData.loaded) return;
    var ticker = document.getElementById('divy-ticker').value;
    var divs = appData.exDiv[ticker];
    var prices = appData.adjClose[ticker];
    if (!divs || !prices) return;
    var lastPrice = prices[prices.length - 1];
    var yld = dividendYield(divs, lastPrice);
    showResult('divy-result', yld);
    document.getElementById('divy-result').textContent = formatResult(yld) + '%';
    // Show dividend count
    var count = divs.filter(function(d) { return d > 0; }).length;
    var total = 0;
    divs.forEach(function(d) { if (d > 0) total += d; });
    document.getElementById('divy-info').textContent =
        count + ' dividends totaling $' + total.toFixed(2) + ' over ' +
        appData.dates.length + ' trading days';
}

function calcMedianReturn() {
    if (!appData.loaded) return;
    var ticker = document.getElementById('median-ticker').value;
    var rets = logReturns(ticker);
    if (rets.length === 0) return;
    var med = median(rets);
    showResult('median-result', med * 100);
    document.getElementById('median-result').textContent = formatResult(med * 100) + '%';
    document.getElementById('median-info').textContent =
        'Median of ' + rets.length + ' daily log returns (annualized: ' +
        formatResult(med * 252 * 100) + '%)';
}

function calcCovariance() {
    if (!appData.loaded) return;
    var checkboxes = document.querySelectorAll('#cov-tickers input[type=checkbox]:checked');
    var tickers = [];
    for (var i = 0; i < checkboxes.length; i++) tickers.push(checkboxes[i].value);
    if (tickers.length < 2) {
        document.getElementById('cov-result').textContent = 'Select at least 2 tickers';
        return;
    }
    var matrix = covarianceMatrix(tickers);
    if (!matrix) return;

    // Build text table
    var lines = ['Annualized Covariance Matrix (×252):\n'];
    var header = '        ';
    for (var j = 0; j < tickers.length; j++) header += tickers[j].padStart(10);
    lines.push(header);
    for (var i = 0; i < tickers.length; i++) {
        var row = tickers[i].padEnd(8);
        for (var j = 0; j < tickers.length; j++) {
            row += matrix[i][j].toFixed(6).padStart(10);
        }
        lines.push(row);
    }

    // Correlation matrix
    lines.push('\nCorrelation Matrix:');
    header = '        ';
    for (var j = 0; j < tickers.length; j++) header += tickers[j].padStart(10);
    lines.push(header);
    for (var i = 0; i < tickers.length; i++) {
        var row = tickers[i].padEnd(8);
        for (var j = 0; j < tickers.length; j++) {
            var corr = matrix[i][j] / Math.sqrt(matrix[i][i] * matrix[j][j]);
            row += corr.toFixed(4).padStart(10);
        }
        lines.push(row);
    }

    var el = document.getElementById('cov-result');
    el.style.textAlign = 'left';
    el.style.fontSize = '12px';
    el.style.fontFamily = 'monospace';
    el.style.whiteSpace = 'pre';
    el.textContent = lines.join('\n');
    el.className = 'result positive';
}

// --- File Picker ---

function androidLoadCSV() {
    if (typeof Android !== 'undefined' && Android.openFilePicker) {
        Android.openFilePicker();
    } else {
        // Desktop/browser fallback
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = function(e) {
            var file = e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function(ev) {
                receiveCSV(ev.target.result, file.name);
            };
            reader.readAsText(file);
        };
        input.click();
    }
}

// --- Opening a view from outside (the demo's app switch) ---

/*
 * Named views the app can be opened to, from an intent extra ("open") that
 * MainActivity passes here. Only these names do anything: the extra comes
 * from outside the app, so it selects a view, never runs one.
 *
 *   pv-learn   Calculate tab, the Portfolio Variance card at the top with its
 *              Learn More open and only the book's five names ticked -- where
 *              the demo lands when it switches from the camera to calcs, so
 *              one tap on Calculate gives the book's 19.94 %. (The page ticks
 *              the indices by default; with them the answer is an eight-name
 *              portfolio, not the book.)
 */
var KANAHA_VIEWS = {
    'pv-learn': { tab: 'calculate', card: 'card-pv', learnMore: true,
                  tickers: ['MSFT', 'AAPL', 'AMZN', 'JPM', 'JNJ'],
                  clear: ['pv-result', 'pv-info'] }
};

function kanahaOpen(name, attempt) {
    var view = KANAHA_VIEWS[name];
    var card, details, tickers;
    attempt = attempt || 0;
    if (!view) return false;
    switchTab(view.tab);
    card = document.getElementById(view.card);
    tickers = document.getElementById('pv-tickers');
    // The ticker boxes are filled once the data has loaded; scrolling before
    // that lands the card in the wrong place, so wait for them (up to ~3 s).
    if (!card || (tickers && tickers.children.length === 0 && attempt < 30)) {
        setTimeout(function () { kanahaOpen(name, attempt + 1); }, 100);
        return true;
    }
    details = card.querySelector('details');
    if (details && view.learnMore) details.open = true;
    if (view.tickers && tickers) {
        var boxes = tickers.querySelectorAll('input[type=checkbox]');
        for (var b = 0; b < boxes.length; b++)
            boxes[b].checked = view.tickers.indexOf(boxes[b].value) >= 0;
    }
    /* The result and its caption, cleared together: the tap on stage computes
     * them fresh, and a caption with no result above it looks like a fault. */
    if (view.clear) {
        for (var c = 0; c < view.clear.length; c++) {
            var el = document.getElementById(view.clear[c]);
            if (el) el.innerHTML = '';
        }
    }
    // The tab bar is pinned (position: sticky), so a plain scrollIntoView puts
    // the card's title underneath it. Land the card just below the bar.
    {
        var bar = document.querySelector('.tab-bar');
        var y = card.getBoundingClientRect().top + window.pageYOffset -
                (bar ? bar.offsetHeight : 0) - 8;
        window.scrollTo(0, Math.max(0, y));
    }
    return true;
}

// --- Tab Switching ---

function switchTab(tabName) {
    var buttons = document.querySelectorAll('.tab-btn');
    var contents = document.querySelectorAll('.tab-content');
    for (var i = 0; i < buttons.length; i++) {
        buttons[i].classList.remove('active');
        contents[i].classList.remove('active');
    }
    document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');
    document.getElementById('tab-' + tabName).classList.add('active');
    // Persist last tab (fund.js reads this on startup)
    try { localStorage.setItem('last_tab', tabName); } catch (e) {}
}
