# arrow-return-style benchmark

Measures where time goes in `flawless/arrow-return-style`, driven by
[`eslint-rule-benchmark`](https://github.com/azat-io/eslint-rule-benchmark).
The rule's predecessor (`eslint-plugin-arrow-return-style-x`) had pathological
performance from spawning Prettier workers; this benchmark exists to keep the
oxfmt-worker path honest.

## Running

```sh
pnpm bench   # `prebench` builds first; see below for why that matters
```

`pnpm bench` runs `prebench` (`nr build`) first, and that is not optional. The
rule locates its oxfmt worker relative to `import.meta.url`, and only the built
layout resolves it to `dist/rules/arrow-return-style/worker.mjs`. With a stale
or missing build the worker silently fails open (every consult returns "fits",
no oxfmt call), so the `useOxfmt:true` cases would report the no-worker cost and
quietly lie. The benchmark points `rulePath` at `dist/index.mjs` on purpose, so
it measures the exact artifact users install.

Fixtures under `cases/` are generated — edit `generate-cases.mjs` and re-run
`node benchmark/generate-cases.mjs`, not the fixtures by hand.

## What each case isolates

The runner lints each fixture with `fix: true`, reusing one ESLint instance
across warmup + measured iterations, so numbers are the **warm, steady-state**
cost. The worker's one-time cold start is spawned during warmup and discarded by
outlier filtering — this benchmark does not measure cold start.

| Case | Path exercised |
| --- | --- |
| no-violation implicit | Pure AST math. No report, worker never consulted — the rule's floor. |
| block → implicit fixes | The fixer + ESLint fix-loop on the block→implicit path. No worker. |
| over-limit distinct, `useOxfmt:false` | Over-limit reports via pure line-length math, no worker. Baseline for the next row. |
| over-limit distinct, `useOxfmt:true` | Same input, but every arrow is a distinct statement → every consult is a **cache miss**. Worst case for the worker. |
| over-limit repeated, `useOxfmt:true` | Textually identical arrows (bare blocks reuse `const x` legally) → same `statementOf` text + `arrowIndex`, so all but the first consult are **cache hits**. |
| realistic mixed | Mostly valid short arrows with a scatter of fixes and a few consults — a typical module linted on save. |

Read the worker's cost as `useOxfmt:true` minus `useOxfmt:false` on the distinct
case. Read the per-file cache's payoff as distinct-vs-repeated at `useOxfmt:true`.

## Reference numbers

AMD Ryzen 9 9950X3D, Node 24.16, ESLint 9.39.4, `eslint-rule-benchmark` 0.8.0
(median time per lint; lower is better):

| Case | Median |
| --- | --- |
| no-violation implicit (60 arrows) | ~2.8 ms |
| block → implicit fixes (60 arrows) | ~24 ms |
| over-limit distinct, `useOxfmt:false` (40 arrows) | ~24 ms |
| over-limit distinct, `useOxfmt:true` (40 arrows) | ~42 ms |
| over-limit repeated, `useOxfmt:true` (40 arrows) | ~25 ms |
| realistic mixed (120 arrows) | ~33 ms |

Takeaways:

- **The worker is cheap and bounded.** 40 distinct cache-miss consults add
  ~16 ms over the pure path (~0.4 ms amortized per consult) — nothing like the
  predecessor's Prettier-worker pathology.
- **The cache erases it for repeats.** The repeated case (~25 ms) matches the
  no-worker baseline: 40 consults collapse to one.
- **Most of the non-floor cost is ESLint's autofix loop, not the rule.** The
  no-violation floor is ~2.8 ms; the fix-loop cases sit at ~24 ms with the
  worker disabled, because ESLint re-parses and re-lints after each fix pass.
  That overhead is inherent to autofix, not the oxfmt bridge.
