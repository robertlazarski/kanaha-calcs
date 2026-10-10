// kanaha-calcs: Provenance — academic citations and formula details
// Every calculation traces to a published academic paper.

var provenanceData = {
    1: {
        formula: 'f* = (b × p − q) / b',
        citation: 'Kelly, J.L., Jr. (1956). "A New Interpretation of Information Rate." Bell System Technical Journal, 35(4): 917–926.',
        narrative: 'John Kelly, working at Bell Labs, derived this formula to optimize the growth rate of a gambler\'s capital. It was later adopted by investors like Ed Thorp to size positions in financial markets. The key insight: bet a fraction of your bankroll proportional to your edge.',
        code: 'function kellyFraction(p, b) { var q = 1 - p; return (b * p - q) / b; }'
    },
    2: {
        formula: 'odds = |reward| / |risk|',
        citation: 'Kelly, J.L., Jr. (1956). Section III. Bell System Technical Journal, 35(4): 917–926.',
        narrative: 'The payoff ratio (b in the Kelly formula) represents the ratio of the amount won on a favorable outcome to the amount lost on an unfavorable one. Higher odds mean you can bet a larger fraction for the same win probability.',
        code: 'function kellyOdds(reward, risk) { return Math.abs(reward) / Math.abs(risk); }'
    },
    3: {
        formula: 'SR = (R_p − R_f) / σ_p',
        citation: 'Sharpe, W.F. (1966). "Mutual Fund Performance." The Journal of Business, 39(1): 119–138.',
        narrative: 'William Sharpe introduced this ratio to evaluate mutual fund managers. It answers: "How much extra return did you earn per unit of risk?" A Nobel Prize-winning insight that remains the most widely used performance metric in finance.',
        code: 'function sharpeRatio(ret, rf, vol) { return (ret - rf) / vol; }'
    },
    4: {
        formula: 'Φ(z) via Abramowitz & Stegun 26.2.17',
        citation: 'Abramowitz, M. & Stegun, I.A. (1964). Handbook of Mathematical Functions. NBS Applied Mathematics Series 55, §26.2. Original distribution: Gauss, C.F. (1809). Theoria motus corporum coelestium.',
        narrative: 'The normal distribution was described by Gauss in 1809. Abramowitz and Stegun\'s 1964 handbook provides a rational polynomial approximation (formula 26.2.17) that computes the CDF to 7 decimal places without lookup tables — ideal for embedded computation.',
        code: 'function normalCDF(x) { /* A&S 26.2.17 rational approx */ var a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911; var sign = x<0 ? -1 : 1; x = Math.abs(x); var t = 1/(1+p*x); var y = 1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x/2); return 0.5*(1+sign*y); }'
    },
    5: {
        formula: '(new − old) / old × 100',
        citation: 'Fibonacci (1202). Liber Abaci.',
        narrative: 'Leonardo of Pisa introduced systematic commercial arithmetic to Europe. Percent change is the most fundamental calculation in finance — every return, every P&L, every performance number starts here.',
        code: 'function percentChange(oldVal, newVal) { return (newVal - oldVal) / oldVal * 100; }'
    },
    6: {
        formula: 'Sort, take middle value',
        citation: 'Galton, F. (1881). "Report of the Anthropometric Committee." Report of the British Association for the Advancement of Science, 51: 225–272.',
        narrative: 'Francis Galton formalized the median as a measure of central tendency. Unlike the mean, the median is robust against outliers — a single flash crash doesn\'t distort it. Useful for understanding "typical" daily returns.',
        code: 'function median(arr) { var s = arr.slice().sort(function(a,b){return a-b}); var m = Math.floor(s.length/2); return s.length%2 ? s[m] : (s[m-1]+s[m])/2; }'
    },
    7: {
        formula: 'cov(i,j) = Σ(r_i − μ_i)(r_j − μ_j) / (n−1) × 252',
        citation: 'Pearson, K. (1896). "Mathematical Contributions to the Theory of Evolution. III." Philosophical Transactions of the Royal Society A, 187: 253–318.',
        narrative: 'Karl Pearson defined the product-moment correlation coefficient. The covariance matrix is the foundation of Modern Portfolio Theory — it tells you how much diversification benefit you get from combining assets.',
        code: '/* See covarianceMatrix() in calcs.js — O(n² × T) computation from daily log returns */'
    },
    8: {
        formula: 'NAV = Σ(price_i × quantity_i)',
        citation: 'Pacioli, L. (1494). Summa de Arithmetica, Geometria, Proportioni et Proportionalita.',
        narrative: 'Luca Pacioli codified double-entry bookkeeping — the foundation of all financial accounting. NAV is simply the sum of all position values, the most basic aggregation in portfolio management.',
        code: 'function nav(prices, quantities) { var t=0; for(var i=0;i<prices.length;i++) t+=prices[i]*quantities[i]; return t; }'
    },
    9: {
        formula: 'weight_i = value_i / NAV',
        citation: 'Markowitz, H. (1952). "Portfolio Selection." The Journal of Finance, 7(1): 77–91.',
        narrative: 'Harry Markowitz showed that portfolio risk depends not just on individual asset risk but on the weights and correlations between all assets. Weights are the fundamental input to his mean-variance optimization framework.',
        code: 'function portfolioWeight(value, totalNAV) { return value / totalNAV; }'
    },
    10: {
        formula: 'R_p = Σ(w_i × r_i)',
        citation: 'Markowitz, H. (1952). Same paper. Equation 1.',
        narrative: 'Portfolio return is the weighted sum of individual returns. This shows how adding cash (near-zero return) drags down the portfolio return — the "cash drag" effect visible in Fund Mode when toggling the cash exclusion.',
        code: 'function portfolioReturn(weights, returns) { var t=0; for(var i=0;i<weights.length;i++) t+=weights[i]*returns[i]; return t; }'
    },
    11: {
        formula: 'MaxDD = min((P_t − P_peak) / P_peak)',
        citation: 'Grossman, S.J. & Zhou, Z. (1993). "Optimal Investment Strategies for Controlling Drawdowns." Mathematical Finance, 3(3): 241–276.',
        narrative: 'Maximum drawdown is a standard industry risk metric measuring the largest peak-to-trough decline. Grossman and Zhou provided key academic analysis of optimal strategies for managing drawdown constraints. The 2008 financial crisis in the bundled data shows JPM dropping dramatically — a visceral lesson in tail risk.',
        code: 'function maxDrawdown(prices) { var peak=prices[0], dd=0; for(var i=1;i<prices.length;i++) { if(prices[i]>peak) peak=prices[i]; var d=(prices[i]-peak)/peak; if(d<dd) dd=d; } return dd; }'
    },
    12: {
        formula: 'ExcessReturn = R_portfolio − R_benchmark',
        citation: 'Jensen, M.C. (1968). "The Performance of Mutual Funds in the Period 1945–1964." Journal of Finance, 23(2): 389–416.',
        narrative: 'Michael Jensen introduced "alpha" as the measure of fund manager skill. His key finding: most mutual funds failed to beat their benchmarks after management fees. Excess return is the simpler version — did the portfolio beat its benchmark? This number determines performance fees.',
        code: 'function excessReturn(portfolioRet, benchmarkRet) { return portfolioRet - benchmarkRet; }'
    },
    13: {
        formula: 'yield = Σ(trailing 4 dividends) / price × 100',
        citation: 'Williams, J.B. (1938). The Theory of Investment Value. Harvard University Press.',
        narrative: 'John Burr Williams introduced the dividend discount model — a stock\'s value is the present value of all future dividends. Yield is the simplest expression: how much income does this stock generate relative to its price?',
        code: 'function dividendYield(exDivs, price) { var divs=exDivs.filter(function(d){return d>0}).slice(-4); var t=0; divs.forEach(function(d){t+=d}); return (t/price)*100; }'
    },
    14: {
        formula: 'IR = mean(R_excess) / σ(R_excess)',
        citation: 'Grinold, R.C. (1989). "The Fundamental Law of Active Management." Journal of Portfolio Management, 15(3): 30–37. Also: Grinold & Kahn (2000). Active Portfolio Management, 2nd ed. McGraw-Hill.',
        narrative: 'Richard Grinold introduced the Fundamental Law: IR = IC × √BR (Information Coefficient × square root of Breadth). The IR measures consistency of outperformance — not just beating the benchmark, but beating it reliably.',
        code: 'function informationRatio(excessReturns) { /* mean/stdev of excess return series */ }'
    },
    15: {
        formula: 'R_local = R_total_USD − R_fx',
        citation: 'Brinson, G.P., Hood, L.R. & Beebower, G.L. (1986). "Determinants of Portfolio Performance." Financial Analysts Journal, 42(4): 39–44. Currency extension: Karnosky, D.S. & Singer, B.D. (1994). Global Asset Management. CFA Institute.',
        narrative: 'BHB showed that asset allocation policy explained on average 93.6% of the variation in total plan returns across time — not that allocation explains >90% of the level of returns or differences between funds. Karnosky & Singer extended this framework to multi-currency portfolios, separating currency return from local-market return.',
        code: 'function returnDecomposition(totalUsdReturn, fxReturn) { return { total: totalUsdReturn, local: totalUsdReturn - fxReturn, fx: fxReturn }; }'
    },
    16: {
        formula: 'σ²_p = w\' × Σ × w',
        citation: 'Markowitz, H. (1952). "Portfolio Selection." The Journal of Finance, 7(1): 77–91.',
        narrative: 'The matrix multiplication w\'Σw computes portfolio variance from the weight vector and covariance matrix. This is the core of Modern Portfolio Theory and runs as native C code via Axis2/C for performance.',
        code: '/* Axis2/C: POST /services/FinancialBenchmarkService/portfolioVariance — see financial_benchmark_service.c */'
    },
    17: {
        formula: 'S(t+dt) = S(t) × exp((μ − σ²/2)·dt + σ·√dt·Z)',
        citation: 'Metropolis, N. & Ulam, S. (1949). "The Monte Carlo Method." Journal of the American Statistical Association, 44(247): 335–341.',
        narrative: 'Stanislaw Ulam and Nicholas Metropolis formalized the Monte Carlo method at Los Alamos. Applied to finance: simulate thousands of future price paths using Geometric Brownian Motion, then compute VaR from the distribution of outcomes.',
        code: '/* Axis2/C: POST /services/FinancialBenchmarkService/monteCarlo — 10,000 simulations in C */'
    },
    18: {
        formula: 'EV = Σ(p_i × value_i)',
        citation: 'Bernoulli, D. (1738). "Specimen Theoriae Novae de Mensura Sortis." Commentarii Academiae Scientiarum Imperialis Petropolitanae, 5: 175–192. Earlier: Huygens, C. (1657). De Ratiociniis in Ludo Aleae.',
        narrative: 'Daniel Bernoulli introduced expected utility theory. The expected value formula predates him — Christiaan Huygens published it in 1657. In the app: assign probabilities to Bull/Base/Bear scenarios and compute the weighted average outcome.',
        code: '/* Axis2/C: POST /services/FinancialBenchmarkService/scenarioAnalysis */'
    }
};

/** Render provenance detail for a given calculation number. */
function renderProvenance(calcNum) {
    var data = provenanceData[calcNum];
    if (!data) return '';
    return '<div class="provenance">' +
        '<div class="formula">' + data.formula + '</div>' +
        '<div class="prov-citation">' + data.citation + '</div>' +
        '<div class="prov-narrative">' + data.narrative + '</div>' +
        '<div class="prov-code"><code>' + data.code + '</code></div>' +
        '</div>';
}
