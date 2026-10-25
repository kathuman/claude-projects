# Scientific Calculator

A scientific calculator for the keyboard or the keys on screen, with financial functions and a running tape of every
calculation.

**Live:** https://kathuman.github.io/claude-projects/scientific-calculator/

## What it does

- **Type or tap whole expressions.** They are parsed with proper operator precedence by the calculator's own parser
  (it never uses `eval`).
- **Functions:**
  - sin, cos and tan and their inverses; sinh, cosh and tanh;
  - ln, log, eˣ and 10ˣ;
  - square root, cube root, x², x³ and xʸ;
  - n!, mod, %, and the constants π and e;
  - `Ans`, the last result.
  - The 2ND key switches keys to their second function.
- **Angles** in degrees, radians or gradians.
- **Memory:** MC, MR and M+.
- **The tape:** every calculation is listed and can be cleared.
- **Financial functions (the FIN strip):**

  | Function | Gives |
  |---|---|
  | `pv(rate, nper, pmt[, fv])` | present value |
  | `fv(rate, nper, pmt[, pv])` | future value |
  | `pmt(rate, nper, pv[, fv])` | payment per period |
  | `nper(rate, pmt, pv[, fv])` | number of periods |
  | `rate(nper, pmt, pv[, fv[, guess]])` | rate per period |
  | `npv(rate, cf1, cf2, …)` | net present value |
  | `irr(cf0, cf1, …)` | internal rate of return |
  | `sl(cost, salvage, life)` | straight-line depreciation |
  | `ci(principal, rate, nper[, n])` | compound interest |
  | `si(principal, rate, time)` | simple interest |

  Rates are fractions per period (6 % is `0.06`).
- **Keyboard:** digits and `. ( ) + − * / ^ ! %`; Enter evaluates, Backspace deletes, Esc clears everything.
- **Remembered between visits:** the angle mode, the memory and the last 40 tape entries, kept only in this browser.

## Files

```
index.html   the calculator: parser, functions, keys, tape
```

Built with [Claude](https://claude.com). Part of [AI Projects](https://kathuman.github.io/claude-projects/).
