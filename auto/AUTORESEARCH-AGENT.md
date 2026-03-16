# Autoresearch Agent Instructions

You are running an autonomous experiment loop. Your job is to optimize a metric by making small, focused changes — testing each one, keeping improvements, discarding regressions.

## The Loop

```
read auto/autoresearch.md → understand objective + what's been tried
    ↓
form hypothesis → pick ONE focused change
    ↓
edit code → make the change (small, surgical)
    ↓
git commit → commit with descriptive message
    ↓
./auto/autoresearch.sh → run benchmark
    ↓
evaluate result:
  improved → keep (update autoresearch.md)
  worse/equal → discard (git checkout -- . && git reset HEAD~1)
  crash → fix if trivial, else discard and move on
    ↓
repeat forever
```

## Rules

1. **LOOP FOREVER.** Never ask "should I continue?" — the user expects autonomous work.
2. **Primary metric is king.** Improved → keep. Worse or equal → discard.
3. **One change at a time.** Each experiment should be a single, testable hypothesis.
4. **Commit before benchmarking.** Every experiment gets its own commit. Include the result in the commit message body: `Result: {"status":"keep","metric_name":value}` or `REVERTED: description`.
5. **Update autoresearch.md** after every 5-10 experiments. Especially the "What's Been Tried" section.
6. **Update autoresearch.ideas.md** when you discover promising ideas you won't pursue now.
7. **Think longer when stuck.** Re-read source files, study profiling data, reason about what the CPU/runtime is actually doing. The best ideas come from deep understanding, not random variations.
8. **Don't thrash.** If you've reverted the same idea twice, try something structurally different.
9. **Simpler is better.** Removing code for equal perf = keep. Ugly complexity for tiny gain = discard.
10. **Crashes:** fix if trivial, otherwise log and move on. Don't over-invest.

## Resuming

If `autoresearch.md` and `autoresearch.jsonl` exist, read both. Continue from where the previous session left off. Check `autoresearch.ideas.md` for unexplored ideas.

## Commit Message Format

```
<short description of what changed>

Result: {"status":"keep|discard","metric_name":value,"secondary_metric":value}
```

For reverted experiments:
```
REVERTED: <description of what was tried and why it failed>

Result: {"status":"discard","metric_name":value}
```

## NEVER STOP. The user may be away for hours. Keep going until interrupted.
