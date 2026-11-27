# makefun-diff-speed

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/xsrazy/makefun-diff-speed/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/xsrazy/makefun-diff-speed/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

A faster drop-in for [makefun-diff 1.0.0](https://make.fun/bounty/diff-speed-01-run-20261126), make.fun's own line diff: byte-for-byte the same patch, about 3.5x faster on the practice set.

## How it works

`solve.js` exports `run(input)`, which returns makefun-diff 1.0.0's patch of `{ old, new }` as one JSON string. It is the same algorithm, made fast:

- every line is interned once to a small integer id (one shared table for both texts, so equal lines share an id; a bare last line gets a negative id, so it can never match a `"\n"`-terminated line of the same body),
- the common prefix and suffix are trimmed,
- then Myers's greedy search runs exactly as makefun-diff states it — deletion wins a tie, no edge diagonal is pruned, a snake follows every step — over typed arrays, keeping the per-d furthest-x trace in one flat buffer so the edit script is recovered by backtracking instead of by carrying a linked list of path objects,
- the patch writer is makefun-diff's own rule, ported line for line.

No dependencies, no network. `main.ts` is the harness driver: it reads every case from `/input/cases.json`, answers each one alone with `run`, and writes `/output/answers.json`.

## Verification

- Practice set: 4/4 answers byte-identical to the kit's `practice/reference/expected.json`; the kit scorer reports `passed: 1, cases_passed: 4`.
- Fuzz: 289 random pairs (identical, empty, no trailing newline, `\r`, `\r\n`, duplicates, moved blocks, fully random) plus 8 fresh cases drawn with the kit's own generator from other seeds — 0 mismatches against makefun-diff 1.0.0.
- Speed on the practice set (this machine, `run()` only, median of 24 runs per case): house baseline 899 ms/case, this entry 258 ms/case — about 3.5x faster.

## License

MIT. See [LICENSE](LICENSE).
