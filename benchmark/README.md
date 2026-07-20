# flawless rule benchmarks

Wall-clock benchmarks for the plugin's rules, driven by
[`eslint-rule-benchmark`](https://github.com/azat-io/eslint-rule-benchmark).
Two passes share one `config.ts`:

- **`arrow-return-style`** gets a detailed, multi-case profile. Its predecessor
  (`eslint-plugin-arrow-return-style-x`) had pathological performance from
  spawning Prettier workers, so each case isolates a code path to keep the
  oxfmt-worker path honest.
- **Every other rule** gets one coarse run — enough to catch a gross regression,
  not to attribute cost to a code path.

## Running

```sh
pnpm bench   # `prebench` builds first; see below for why that matters
```

`pnpm bench` runs `prebench` (`nr build`) first, and that is not optional.
`arrow-return-style` locates its oxfmt worker relative to `import.meta.url`, and
only the built layout resolves it to `dist/rules/arrow-return-style/worker.mjs`.
With a stale or missing build the worker silently fails open (every consult
returns "fits", no oxfmt call), so the `useOxfmt:true` cases would report the
no-worker cost and quietly lie. The benchmark points `rulePath` at
`dist/index.mjs` on purpose, so it measures the exact artifact users install; the
build also produces the `dist` module `config.ts` imports for its coverage check.

The detailed arrow fixtures under `cases/` are generated — edit
`generate-cases.mjs` and re-run `node benchmark/generate-cases.mjs`, not the
fixtures by hand. The coarse fixtures under `cases/all/` are hand-written.

## All-rules coarse pass

`config.ts` walks a `COARSE` manifest, one entry per rule, each pointing at a
hand-written fixture in `cases/all/<rule>.tsx` sized so its median lifts clear of
sub-millisecond noise. A rule that only reports with options (naming-convention,
…) passes them through the manifest, mirroring its eslint config shape.

Coverage is enforced: `config.ts` cross-checks the manifest against the built
plugin's rule list and, if a rule is neither profiled in detail, present in
`COARSE`, nor a documented `UNSUPPORTED` exemption, prints the gap and sets a
non-zero exit — so a new rule cannot silently skip benchmarking. It flags rather
than throws, so the benchmarks that *can* run still produce numbers; only the
exit code (and CI status) goes red.

Three rules sit in `UNSUPPORTED` because `eslint-rule-benchmark` structurally
cannot run them (revisit if the tool changes):

- `prefer-read-only-props` needs type information, but the harness lints each
  fixture by bare basename — a path no tsconfig can include — so a typed program
  is impossible and the rule reports nothing.
- `toml-sort-keys` and `yaml-block-key-blank-lines` lint TOML/YAML, whose
  extensions are absent from the tool's `SUPPORTED_EXTENSIONS` (js/ts/jsx/tsx,
  plus astro/svelte/vue).

## CI

`.github/workflows/benchmark.yaml` runs on PRs that touch any rule (`src/rules/**`)
or `benchmark/`, and `eslint-rule-benchmark` posts the results as a single
(auto-updated) PR comment. The **timings are informational** — GitHub-hosted
runners are too noisy for absolute wall-clock times to gate a merge, so the job
never fails on a slowdown. It does fail on the coverage gate above (a rule with
no fixture), which is intended: that is a config error to fix, not a measurement.
Reading it: eyeball the comment on rule-touching PRs; for the arrow rows watch
the `useOxfmt:true` cache-miss row and its multiple over the pure row, not the
raw millisecond count. Posting the comment needs repo Actions settings to allow
the workflow token to write pull requests.

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
