# Findings: performance baseline (2026-08-30)

**Method:** `npm run bench` (bench/bench.js), committed with this document so every number
is reproducible. Everything runs against the in-repo fixture on loopback — network ≈ free,
service answers instantly — so what remains visible is Peira's own overhead. Process
timings are medians of 5. Machine: Apple Silicon, Node v22.11.0. This measures the TOOL;
asserting the AUT's latency remains a non-goal (DESIGN.md §6).

The accounting primitive: `run-end` evidence now records `wallMs` (the run's span) and
`httpMs` (Σ of every logged exchange's `elapsedMs`). On a serial, poll-free workload,
`wallMs − httpMs` is exactly the tool's own cost.

## Numbers (v0.1, first record)

| metric | value | note |
|---|---|---|
| boot (usage print) | 38 ms | full node + CLI parse; no transform pipeline exists to warm |
| first verdict, full CLI | 57 ms | boot + load/validate 26 cases + 1 real request + report |
| tool overhead per case | 0.17 ms | 500 poll-free cases, serial, evidence in memory |
| … with evidence JSONL to disk | 0.22 ms | `appendFileSync` per event costs ~0.05 ms/case — **acquitted** |
| corpus (26 cases) serial | ~2.2 s | dominated by two deliberate ~1 s transient-state cases |
| corpus `--parallel 4` / `8` | ~2.1 s | see the contention finding below |

## Findings

1. **No hotspot convicted.** The suspected offender — synchronous `appendFileSync` per
   evidence event — costs ~50 µs per case. At 1,000 cases that is 50 ms total, invisible
   next to real network time. Buffered evidence writes are NOT worth their crash-safety
   risk today; revisit only if a future bench convicts them at scale.
2. **The tight-loop numbers hold the marketing claim.** First verdict through the full CLI
   in under 60 ms — there is no transform pipeline, no JVM, no browser context to boot.
   For comparison shapes (not same-machine measurements): Vitest pays Vite config +
   transform startup, Playwright pays browser context creation, RestAssured pays JVM +
   build-tool startup measured in seconds.
3. **Parallelism is capped by the service, not by Peira.** The corpus gains only ~6% from
   `--parallel 8` because its two long cases contend on the fixture's capacity-2 job queue —
   the AUT serializes what the runner parallelized. This is the honest general lesson:
   `--parallel` buys wall-clock exactly where the service under test permits concurrency.
   (The run stayed green under contention — per-case seeds kept cases independent.)
4. **The watch loop's floor is the debounce, not the tool.** A single-case re-run costs
   ~5 ms in-process; the 200 ms fs-event debounce dominates save→verdict latency. Tool
   overhead is already below human perception in the tight loop.

## Standing practice

Re-run `npm run bench` per release; append a dated row set here when numbers move
meaningfully. Any optimization PR must carry a before/after from this harness — measured,
not promised, applied to ourselves.
