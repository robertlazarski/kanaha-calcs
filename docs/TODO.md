---
type: planning
created: 2026-09-20
---

# TODO — work that the live demo does not touch

## BLUF

Everything here can land after the demo without changing a single beat of it.
That is the entry criterion: if a change would alter what the six demo steps
show, it does not belong on this list, it belongs in a rehearsal.

The demo drives the app by hand under screen mirroring and uses, in order, the
Monte Carlo card, the portfolio variance card, the scenario card, and the two
Learn More panels. Anything else in the app is free ground.

## Not on the demo path

### 1. Cards for the two covariance operations

The app calls the native service from three cards today. The operations added
on 2026-09-20 have no user interface at all: they are reachable over HTTPS and
over MCP, and invisible in the app itself.

Two cards would close that, both additive:

- **Covariance from the device's own CSV.** Pick a file, pick columns, get the
  matrix, the per-asset volatilities, the implied correlations, the observation
  count and the date range the file actually covered. This is the operation that
  makes "the phone built the matrix from its own data" a thing a person can see
  rather than a claim.
- **Compose a covariance matrix.** Type volatilities and one correlation, get a
  stressed matrix back with its positive-definiteness verdict, and hand it to
  the variance card. The regime override, made visible.

Each card is four pieces, following the pattern of cards 16 to 18: the markup
with inputs, a button, a result area and a `<details>` expander; a handler that
posts through the Java bridge; an entry in the provenance table keyed by the
card number; and a glossary term where one is missing. Citations to use are
Pearson (1896) for the estimator, Bessel's correction for the denominator, and
Cholesky–Banachiewicz for the positive-definiteness check, matching the style
of the Markowitz and Metropolis entries already there.

One design note before starting: the native operations read files under the
app's own storage, while the WebView holds an imported file only in memory.
A card cannot simply pass what the page is holding. It has to list what the
device has, which is what `listCsvFiles` is for, and let the user choose from
that list.

**Done 2026-09-20: card 16 now builds its matrix in C.** It calls
covarianceFromCsv on the device's own file and passes the result to
portfolioVariance, falling back to the old JavaScript estimator when no file
carries the selected columns. That one was on the demo path, so it was done
deliberately and verified against the previous numbers rather than left on this
list.

### 2. Provenance and glossary entries

The provenance table and the glossary have no entries for the new operations.
These can land before the cards and stand on their own, since the glossary is
its own tab.

### 3. ~~On-device key generation~~ done 2026-09-08

The device mints its own key pair at first run and serves only after an
operator signs its CSR; no key ships in the APK. See `SECURITY.md`.

### 4. ~~Pre-publication scrub~~ done 2026-10-09

Before each release, grep again for personal references, absolute home paths,
and anything that names a private system or a licensed data source.

### 5. ~~The Fund tab reads as broken when it is merely empty~~ done 2026-09-22

Opening Fund on a fresh install shows NAV $0.00, return 0.00 %, volatility
0.00 %, Sharpe 0.0000 and max drawdown 0.00 % — five metrics, all zero, above a
position table where every quantity is zero. Nothing is wrong: the tab is
implemented end to end, state persists (localStorage carries `fund_positions`,
`fund_cash`, `fund_benchmark`), and entering a quantity computes everything.
The tab simply starts with an empty book.

It is still worth fixing, for two reasons. Every other card in the app ships
with its inputs pre-filled — Kelly at 0.6 and 2.0, the ticker fields at AAPL —
so the Fund tab is the one place the app's own convention is broken. And a
screen of zeros is indistinguishable, to a room, from a screen that failed.

**Done:** `seedFundIfEmpty()` buys the loaded file's equities in equal notional
amounts to a round starting NAV, so the tab opens as a fund rather than five
zeros, and the book it shows is the same five names at equal weight the voice
path uses. It follows the data rather than naming anything, so an uploaded file
seeds its own equities; indices and currency pairs stay at zero. It fires only
on a genuinely untouched book -- no saved positions, or everything and the cash
at zero -- so a deliberate flat book survives. A reinstall still clears
localStorage, which now reseeds rather than showing zeros.

### 6. ~~Two implementations of portfolio volatility~~ half done 2026-09-22

The Fund tab computes portfolio volatility, Sharpe and max drawdown in
JavaScript, from equal-length log return series over the whole loaded period.
The portfolio variance card computes volatility in C from a covariance matrix,
and the voice path computes it in C from the device's own CSV. These are the
same quantity by two routes, and they can disagree — different windows,
different estimators, no shared code.

This is the computational form of the divergence already noted for the two data
copies: the same number, arrived at twice, with nothing checking that they
match.

**Done, by subtraction:** the Fund tab's volatility and Sharpe tiles are removed
along with the JavaScript that produced them, so the number now has one
implementation. **Still owed:** bringing them back through the native service
the way card 16 does, which is the version worth having. Until then the tab
reports NAV, return and max drawdown only.

**Also done:** the Return tile showed the whole-period total -- 708.77 % over
ten years on the seeded book -- under a label that said only "Return". It now
reports the compound annual rate, 23.36 %, labelled "Return (annualised)", and
the benchmark excess is annualised on both sides so it cannot contradict the
headline.

Two smaller things in the same file: the Fund tab's Sharpe assumes a risk-free
rate of zero, while the standalone Sharpe card (#3) takes one as an input, and
the position inputs are `min="0" step="1"`, so a short or a fractional holding
cannot be expressed.

## Related, but not in this repository

- The financial benchmark service upstream has a fuzz harness that the fuzzing
  build script does not build, so the service is not fuzzed today. The harness
  compiles and exercises all three covariance paths; what is missing is a block
  in the build script and a seed corpus carrying the new keys.

## Ordering

The cards are the most visible item and the least urgent. The key generation is
the least visible and gates anything public. If only one thing gets done, make
it the key generation; if the goal is to show the new operations to someone, do
the cards.
