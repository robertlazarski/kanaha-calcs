// kanaha-calcs: Glossary — financial terms with definitions
// Terms sourced from DESIGN_PRINCIPLES.md

var glossaryTerms = [
    { term: 'NAV', definition: 'Net Asset Value. The total value of all positions in a portfolio, computed as the sum of (price × quantity) for each holding. Optionally includes cash.', computed: '#8' },
    { term: 'AUM', definition: 'Assets Under Management. The total market value of investments managed by a fund or institution. Reported to clients and regulators.', computed: null },
    { term: 'Long', definition: 'A position that profits when the price rises. Buying 100 shares of AAPL is a long position. The most common type of investment.', computed: null },
    { term: 'Short', definition: 'A position that profits when the price falls. Borrowing and selling shares you don\'t own, intending to buy them back cheaper. Adds complexity (margin, borrow costs, unlimited loss potential).', computed: null },
    { term: 'Alpha', definition: 'Return above what the market (or a benchmark) delivered. A fund returning 12% when the benchmark returned 10% generated 2% alpha. The measure of manager skill vs. luck.', computed: null },
    { term: 'Beta', definition: 'A measure of how much a stock moves relative to the market. Beta = 1.0 means it moves with the market. Beta > 1.0 means more volatile; < 1.0 means less volatile.', computed: null },
    { term: 'Sharpe Ratio', definition: 'Risk-adjusted return: (return − risk-free rate) / volatility. Measures how much excess return you earn per unit of risk. SR > 1.0 is good; > 2.0 is excellent.', computed: '#3' },
    { term: 'Kelly Criterion', definition: 'The mathematically optimal fraction of capital to bet. f* = (bp − q) / b, where p = win probability, b = win/loss ratio. Maximizes long-term geometric growth.', computed: '#1' },
    { term: 'Volatility', definition: 'The standard deviation of returns, usually annualized (× √252 for daily data). Higher volatility = wider range of possible outcomes = more risk.', computed: 'Charts' },
    { term: 'Drawdown', definition: 'The decline from a peak to a subsequent trough. Maximum drawdown is the worst peak-to-trough loss in a period. JPM\'s max drawdown during 2008 was dramatic.', computed: '#11' },
    { term: 'Covariance', definition: 'How two assets\' returns move together. Positive covariance means they tend to move in the same direction. The foundation of portfolio diversification (Markowitz, 1952).', computed: '#7' },
    { term: 'Correlation', definition: 'Covariance normalized to [−1, +1]. ρ = cov(i,j) / (σ_i × σ_j). Correlation of +1 means perfect co-movement; −1 means perfect inverse movement; 0 means no linear relationship.', computed: '#7' },
    { term: 'DXY', definition: 'US Dollar Index — a proprietary ICE/NYSE index measuring the dollar against 6 currencies (EUR, JPY, GBP, CHF, SEK, CAD). Euro-heavy (57.6% weight). See DTWEXBGS for the Fed equivalent.', computed: null },
    { term: 'DTWEXBGS', definition: 'Federal Reserve Trade-Weighted Broad Dollar Index. GDP-weighted basket of ~26 currencies. Broader and more representative than DXY. Public domain data.', computed: null },
    { term: 'CAPE', definition: 'Cyclically Adjusted Price-to-Earnings ratio (Shiller P/E). Current price divided by the average of 10 years of inflation-adjusted earnings. Requires earnings data not in the CSV.', computed: null },
    { term: 'VIX', definition: 'CBOE Volatility Index — the market\'s expectation of 30-day S&P 500 volatility, derived from option prices. Often called the "fear index." VIX > 30 indicates high fear.', computed: null },
    { term: 'TINA', definition: '"There Is No Alternative." The argument that stocks must be bought because bonds yield too little. Common in low interest rate environments.', computed: null },
    { term: 'Bond', definition: 'A debt instrument where the issuer promises to pay interest (coupon) and return principal at maturity. Considered lower risk than stocks but with lower expected returns.', computed: null },
    { term: 'Inflation', definition: 'The rate at which prices rise over time, eroding purchasing power. CPI is the most common measure. Central banks target ~2% annual inflation.', computed: null },
    { term: 'Market Impact', definition: 'The price movement caused by your own trading. Large orders move the market against you. Estimated as σ × √(Q/V) where Q = order size, V = daily volume.', computed: null },
    { term: 'Capacity Constraint', definition: 'The maximum AUM a strategy can manage before market impact erodes returns. A $100M strategy may not scale to $10B because trading larger sizes moves prices.', computed: null },
    { term: 'Dividend Yield', definition: 'Trailing 12-month dividends divided by current price, expressed as a percentage. JNJ is a Dividend King; AMZN pays nothing.', computed: '#13' },
    { term: 'Information Ratio', definition: 'Mean excess return / tracking error. IR = IC × √BR (Fundamental Law). Measures consistency of outperformance. IR > 1.0 is strong; > 2.0 is rare.', computed: '#14' },
    { term: 'Tracking Error', definition: 'The standard deviation of excess returns vs. a benchmark. Low tracking error means the portfolio closely follows its benchmark.', computed: '#14' },
    { term: 'Log Return', definition: 'r = ln(P_t / P_{t-1}). Continuously compounded return. Preferred for statistical analysis because log returns are additive over time and approximately normally distributed.', computed: '#7' },
    { term: 'Adjusted Close', definition: 'The closing price retroactively adjusted for dividends and stock splits. Provides a consistent basis for computing returns over long periods. The AAPL 7:1 split is a clear example.', computed: 'Charts' },
    { term: 'Ex-Dividend', definition: 'The date on which a stock begins trading without its declared dividend. Buyers on or after this date do not receive the dividend. The ExDiv column in the CSV records these.', computed: '#13' },
    { term: 'Monte Carlo', definition: 'A simulation method using random sampling. For VaR: simulate thousands of possible future price paths using GBM, then find the worst outcomes at a given confidence level.', computed: 'Phase 5' },
    { term: 'VaR', definition: 'Value at Risk. The maximum expected loss at a given confidence level (e.g., 95% VaR = the loss exceeded only 5% of the time). Computed via Monte Carlo simulation.', computed: 'Phase 5' },
    { term: 'Scenario Analysis', definition: 'Assign probabilities to Bull/Base/Bear outcomes, compute expected value. A generic expected value calculator — not a proprietary scenario grid.', computed: 'Phase 5' },
    { term: 'Normal Distribution', definition: 'The bell curve (Gaussian). Returns are often assumed normal for simplicity. Φ(z) gives the probability of observing a value ≤ z standard deviations from the mean.', computed: '#4' },
    { term: 'Black Swan', definition: 'An unpredictable, catastrophic event that no statistical model can forecast — pandemics, financial collapses, geopolitical shocks. Nassim Nicholas Taleb (2007) argued that standard risk models (including normal distributions and VaR) systematically underestimate these tail events because they assume the future resembles the past. The implication: no model can protect you from what you cannot imagine.', computed: null },
    { term: 'Excess Return', definition: 'Portfolio return minus benchmark return. The number that determines whether an active fund earns performance fees.', computed: '#12' }
];

// Sort alphabetically
glossaryTerms.sort(function(a, b) {
    return a.term.localeCompare(b.term);
});

/** Render glossary list, filtered by search query. */
function renderGlossary(filter) {
    var container = document.getElementById('glossary-list');
    container.innerHTML = '';
    var query = (filter || '').toLowerCase();

    for (var i = 0; i < glossaryTerms.length; i++) {
        var entry = glossaryTerms[i];
        if (query && entry.term.toLowerCase().indexOf(query) === -1 &&
            entry.definition.toLowerCase().indexOf(query) === -1) continue;

        var div = document.createElement('div');
        div.className = 'glossary-entry';

        var header = document.createElement('div');
        header.className = 'glossary-term';
        header.textContent = entry.term;
        div.appendChild(header);

        var def = document.createElement('div');
        def.className = 'glossary-def';
        def.textContent = entry.definition;
        div.appendChild(def);

        if (entry.computed) {
            var comp = document.createElement('div');
            comp.className = 'glossary-computed';
            comp.textContent = 'Computed: ' + entry.computed;
            div.appendChild(comp);
        }

        container.appendChild(div);
    }
}

/** Initialize glossary on page load. */
document.addEventListener('DOMContentLoaded', function() {
    renderGlossary('');
    var searchInput = document.getElementById('glossary-search');
    if (searchInput) {
        searchInput.addEventListener('keyup', function() {
            renderGlossary(this.value);
        });
    }
});
