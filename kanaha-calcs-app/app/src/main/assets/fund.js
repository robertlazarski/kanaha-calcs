// kanaha-calcs: Fund Mode — portfolio construction and analysis
// Calculations: NAV (#8), Weight (#9), Return (#10), Excess Return (#12),
// Information Ratio (#14), Return Decomposition (#15)

var fundState = {
    positions: {},  // { MSFT: 100, AAPL: 50, ... }
    cash: 0,
    excludeCash: false,
    benchmark: null
};

/*
 * A starting book, so the tab shows a fund rather than five zeros.
 *
 * An empty portfolio is a legitimate state and an unreadable one: NAV $0.00
 * above a table of zeros is indistinguishable, at a glance, from a screen that
 * failed to load. Every other card in this app opens with its inputs filled in;
 * this makes the fund tab agree with that.
 *
 * It follows the data rather than naming anything: whatever equities the loaded
 * file carries -- bundled or uploaded -- are bought in equal notional amounts to
 * a round starting NAV. Indices and currency pairs are left at zero, because a
 * book of currency pairs is not a fund anyone would recognise.
 *
 * Seeding happens only when the book is genuinely untouched: no saved positions
 * at all, or every quantity and the cash balance at zero. Anything a person has
 * typed survives, including a deliberate flat book with cash in it.
 */
function seedFundIfEmpty() {
    var touched = false;
    for (var k in fundState.positions) {
        if (fundState.positions[k]) { touched = true; break; }
    }
    if (touched || fundState.cash) return;

    var equities = classifyTickers(appData.tickers).equities;
    if (!equities.length) return;

    var START_NAV = 1000000;          // a round number, not a claim about anyone's fund
    var perName = START_NAV / equities.length;
    for (var i = 0; i < equities.length; i++) {
        var tk = equities[i];
        var series = appData.adjClose[tk];
        if (!series || !series.length) continue;
        var last = series[series.length - 1];
        if (!(last > 0)) continue;
        fundState.positions[tk] = Math.round(perName / last);
    }
    saveFundState();
}

/** Initialize Fund Mode UI when data is loaded. */
function initFundMode() {
    if (!appData.loaded) return;

    // Load saved state
    loadFundState();
    seedFundIfEmpty();

    // Build position table
    var tbody = document.getElementById('fund-positions');
    tbody.innerHTML = '';
    for (var i = 0; i < appData.tickers.length; i++) {
        var tk = appData.tickers[i];
        var lastPrice = appData.adjClose[tk][appData.adjClose[tk].length - 1];
        var qty = fundState.positions[tk] || 0;
        var value = lastPrice * qty;

        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td>' + tk + '</td>' +
            '<td><input type="number" class="fund-qty" data-ticker="' + tk + '" value="' + qty + '" min="0" step="1" onchange="updateFund()"></td>' +
            '<td class="right">$' + lastPrice.toFixed(2) + '</td>' +
            '<td class="right fund-value" data-ticker="' + tk + '">$' + value.toFixed(2) + '</td>' +
            '<td class="right fund-weight" data-ticker="' + tk + '">0%</td>';
        tbody.appendChild(tr);
    }

    // Cash input
    document.getElementById('fund-cash-input').value = fundState.cash;
    document.getElementById('fund-exclude-cash').checked = fundState.excludeCash;

    // Benchmark dropdown
    var benchSelect = document.getElementById('fund-benchmark');
    benchSelect.innerHTML = '<option value="">None</option>';
    for (var i = 0; i < appData.tickers.length; i++) {
        var opt = document.createElement('option');
        opt.value = appData.tickers[i];
        opt.textContent = appData.tickers[i];
        if (appData.tickers[i] === fundState.benchmark) opt.selected = true;
        benchSelect.appendChild(opt);
    }

    updateFund();
}

/** Recompute all fund metrics when any input changes. */
function updateFund() {
    if (!appData.loaded) return;

    // Read quantities
    var inputs = document.querySelectorAll('.fund-qty');
    for (var i = 0; i < inputs.length; i++) {
        var tk = inputs[i].getAttribute('data-ticker');
        fundState.positions[tk] = parseFloat(inputs[i].value) || 0;
    }
    fundState.cash = parseFloat(document.getElementById('fund-cash-input').value) || 0;
    fundState.excludeCash = document.getElementById('fund-exclude-cash').checked;
    fundState.benchmark = document.getElementById('fund-benchmark').value || null;

    // Compute NAV
    var totalValue = 0;
    var positionValues = {};
    for (var i = 0; i < appData.tickers.length; i++) {
        var tk = appData.tickers[i];
        var lastPrice = appData.adjClose[tk][appData.adjClose[tk].length - 1];
        var qty = fundState.positions[tk] || 0;
        var val = lastPrice * qty;
        positionValues[tk] = val;
        totalValue += val;
    }

    var navTotal = totalValue + (fundState.excludeCash ? 0 : fundState.cash);
    document.getElementById('fund-nav').textContent = '$' + navTotal.toFixed(2);
    document.getElementById('fund-nav').className = 'metric-value ' + (navTotal >= 0 ? 'positive' : 'negative');

    // Update weights
    for (var i = 0; i < appData.tickers.length; i++) {
        var tk = appData.tickers[i];
        var val = positionValues[tk];
        var wt = navTotal > 0 ? (val / navTotal * 100) : 0;
        document.querySelector('.fund-value[data-ticker="' + tk + '"]').textContent = '$' + val.toFixed(2);
        document.querySelector('.fund-weight[data-ticker="' + tk + '"]').textContent = wt.toFixed(1) + '%';
    }

    // Portfolio return (using full period)
    var weights = [];
    var rets = [];
    for (var i = 0; i < appData.tickers.length; i++) {
        var tk = appData.tickers[i];
        var wt = navTotal > 0 ? positionValues[tk] / navTotal : 0;
        weights.push(wt);
        var prices = appData.adjClose[tk];
        var totalRet = (prices[prices.length - 1] - prices[0]) / prices[0];
        rets.push(totalRet);
    }
    var portRet = portfolioReturn(weights, rets);

    // Annualised, not cumulative. The whole-period figure on ten years of this
    // data reads 708 %, which a person scanning a row of metrics will take for
    // an annual number and disbelieve the moment they do the arithmetic. The
    // compound annual rate is the one that can sit next to a volatility without
    // being misread.
    var years = appData.dates.length / 252;
    var annRet = annualise(portRet, years);
    document.getElementById('fund-return').textContent = (annRet * 100).toFixed(2) + '%';
    document.getElementById('fund-return').className = 'metric-value ' + (annRet >= 0 ? 'positive' : 'negative');

    // Portfolio volatility is NOT computed here, deliberately.
    //
    // It used to be: standard deviation of weighted daily log returns over the
    // whole loaded period, annualised by sqrt(252), in JavaScript. The
    // portfolio variance card computes the same quantity in C from a covariance
    // matrix, and so does the native path the MCP and HTTPS callers use. Two
    // implementations of one number, over different windows, with nothing
    // checking that they agree -- and when they disagreed, the screen offered no
    // way to tell which was wrong.
    //
    // The Sharpe ratio went with it, since it divides by that volatility. Both
    // belong here again the day this tab asks the native service for them, the
    // way card 16 does.
    var portLogRets = computePortfolioLogReturns(weights);

    // Max drawdown of portfolio
    var portPrices = computePortfolioPrices(weights);
    var dd = maxDrawdown(portPrices);
    document.getElementById('fund-drawdown').textContent = (dd * 100).toFixed(2) + '%';
    document.getElementById('fund-drawdown').className = 'metric-value negative';

    // Excess return and IR (if benchmark selected)
    var benchSection = document.getElementById('fund-bench-metrics');
    if (fundState.benchmark && appData.adjClose[fundState.benchmark]) {
        benchSection.style.display = 'block';
        var benchPrices = appData.adjClose[fundState.benchmark];
        var benchRet = (benchPrices[benchPrices.length - 1] - benchPrices[0]) / benchPrices[0];
        // Both sides annualised, so the difference sits beside the headline
        // return rather than contradicting it.
        var excess = excessReturn(annRet, annualise(benchRet, years));
        document.getElementById('fund-excess').textContent = (excess * 100).toFixed(2) + '%';
        document.getElementById('fund-excess').className = 'metric-value ' + (excess >= 0 ? 'positive' : 'negative');

        // Information Ratio from daily excess returns
        var benchLogRets = logReturns(fundState.benchmark);
        var excessRets = [];
        var n = Math.min(portLogRets.length, benchLogRets.length);
        for (var j = 0; j < n; j++) {
            excessRets.push(portLogRets[j] - benchLogRets[j]);
        }
        var ir = informationRatio(excessRets);
        // Annualize IR by sqrt(252): daily mean scales x252, daily stdev
        // scales x sqrt(252), so their ratio (IR) scales by sqrt(252).
        var irAnn = ir * Math.sqrt(252);
        document.getElementById('fund-ir').textContent = irAnn.toFixed(4);
        document.getElementById('fund-ir').className = 'metric-value ' + (irAnn >= 0 ? 'positive' : 'negative');
    } else {
        benchSection.style.display = 'none';
    }

    // Save state
    saveFundState();
}

/*
 * Compound annual rate from a whole-period return.
 *
 * The period is trading days over 252 rather than calendar dates, to match the
 * annualisation the rest of the app uses. A total loss or worse leaves the root
 * undefined, so it is reported as -100 % rather than NaN.
 */
function annualise(totalRet, years) {
    if (!(years > 0)) return 0;
    if (1 + totalRet <= 0) return -1;
    return Math.pow(1 + totalRet, 1 / years) - 1;
}

/** Compute weighted portfolio log returns series. */
function computePortfolioLogReturns(weights) {
    var n = Infinity;
    var allRets = [];
    for (var i = 0; i < appData.tickers.length; i++) {
        var rets = logReturns(appData.tickers[i]);
        allRets.push(rets);
        n = Math.min(n, rets.length);
    }
    if (n === 0 || n === Infinity) return [];
    var portRets = [];
    for (var d = 0; d < n; d++) {
        var r = 0;
        for (var i = 0; i < weights.length; i++) {
            r += weights[i] * allRets[i][d];
        }
        portRets.push(r);
    }
    return portRets;
}

/*
 * Reconstruct a synthetic price series from log returns for drawdown calc.
 * Starts at 100 (arbitrary base — drawdown is scale-invariant).
 * Math.exp(logReturn) converts log return back to a price ratio, since
 * logReturn = ln(P_t / P_{t-1}), so P_t = P_{t-1} * exp(logReturn).
 */
function computePortfolioPrices(weights) {
    var logRets = computePortfolioLogReturns(weights);
    var prices = [100]; // start at 100
    for (var i = 0; i < logRets.length; i++) {
        prices.push(prices[i] * Math.exp(logRets[i]));
    }
    return prices;
}

/*
 * Persist fund state to localStorage. The try/catch is required because
 * WebView can throw SecurityException if storage is disabled or full.
 * localStorage is synchronous key-value (like a tiny embedded DB) — no
 * async callbacks needed, but also no transactions or schema.
 */
function saveFundState() {
    try {
        localStorage.setItem('fund_positions', JSON.stringify(fundState.positions));
        localStorage.setItem('fund_cash', fundState.cash.toString());
        localStorage.setItem('cash_excluded', fundState.excludeCash.toString());
        localStorage.setItem('fund_benchmark', fundState.benchmark || '');
    } catch (e) {}
}

/** Load fund state from localStorage. */
function loadFundState() {
    try {
        var pos = localStorage.getItem('fund_positions');
        if (pos) fundState.positions = JSON.parse(pos);
        var cash = localStorage.getItem('fund_cash');
        if (cash) fundState.cash = parseFloat(cash);
        fundState.excludeCash = localStorage.getItem('cash_excluded') === 'true';
        fundState.benchmark = localStorage.getItem('fund_benchmark') || null;
    } catch (e) {}
}

/** Save and restore last active tab. */
function saveLastTab(tabName) {
    try { localStorage.setItem('last_tab', tabName); } catch (e) {}
}

function restoreLastTab() {
    try {
        var tab = localStorage.getItem('last_tab');
        if (tab) switchTab(tab);
    } catch (e) {}
}

/*
 * JS "monkey-patch" pattern to extend onDataLoaded() without modifying data.js.
 * Since JS functions are first-class values (like function pointers in C),
 * we save the old function, replace the global with a wrapper that calls both.
 * This is the JS equivalent of wrapping a callback — no interface/abstract
 * class needed. The script load order in index.html matters: data.js must
 * load before fund.js so onDataLoaded is defined when we capture it here.
 */
var origOnDataLoaded = onDataLoaded;
onDataLoaded = function() {
    origOnDataLoaded();
    initFundMode();
};

// Restore last tab on load
document.addEventListener('DOMContentLoaded', function() {
    restoreLastTab();
});
