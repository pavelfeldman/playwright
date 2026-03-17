---
name: playwright-trace
description: Inspect Playwright trace files from the command line — list actions, view network, console, errors, snapshots and screenshots.
allowed-tools: Bash(npx:*)
---

# Playwright Trace CLI

Inspect `.zip` trace files produced by Playwright tests without opening a browser.

## Workflow

1. Start with `trace info` to understand what's in the trace.
2. Use `trace list` to see all actions with their call IDs.
3. Use `trace show <callId>` to drill into a specific action — see parameters, logs, source location, and available snapshots.
4. Use `trace network`, `trace console`, or `trace errors` for cross-cutting views.
5. Use `trace snapshot` or `trace screenshot` to extract visual state.

All commands support `--json` for structured output.

## Commands

### Overview

```bash
# Trace metadata: browser, viewport, duration, action/error counts
npx playwright trace info <trace.zip>
npx playwright trace info --json <trace.zip>
```

### Actions

```bash
# List all actions as a tree with call IDs and timing
npx playwright trace list <trace.zip>

# Flat list instead of tree
npx playwright trace list --flat <trace.zip>

# Filter by action title (regex, case-insensitive)
npx playwright trace list --grep "click" <trace.zip>

# Only failed actions
npx playwright trace list --errors-only <trace.zip>

# JSON output with full action metadata
npx playwright trace list --json <trace.zip>
```

### Action details

```bash
# Show full details for one action: params, result, logs, source, snapshots
npx playwright trace show <trace.zip> <call-id>

# JSON output
npx playwright trace show --json <trace.zip> <call-id>
```

The `show` command displays available snapshot phases (before, input, after) and the exact command to extract them.

### Network

```bash
# All network requests: method, status, URL, duration, size
npx playwright trace network <trace.zip>

# Filter by URL pattern
npx playwright trace network --grep "api" <trace.zip>

# Filter by HTTP method
npx playwright trace network --method POST <trace.zip>

# Only failed requests (status >= 400)
npx playwright trace network --failed <trace.zip>

# JSON output with full HAR-like entries
npx playwright trace network --json <trace.zip>
```

### Console

```bash
# All console messages and stdout/stderr
npx playwright trace console <trace.zip>

# Only errors
npx playwright trace console --errors-only <trace.zip>

# Only browser console (no stdout/stderr)
npx playwright trace console --browser <trace.zip>

# Only stdout/stderr (no browser console)
npx playwright trace console --stdio <trace.zip>

# JSON output
npx playwright trace console --json <trace.zip>
```

### Errors

```bash
# All errors with stack traces and associated actions
npx playwright trace errors <trace.zip>

# JSON output
npx playwright trace errors --json <trace.zip>
```

### Snapshots

```bash
# Save DOM snapshot as HTML (tries input, then before, then after)
npx playwright trace snapshot <trace.zip> <call-id> -o snapshot.html

# Save a specific phase
npx playwright trace snapshot --name before <trace.zip> <call-id> -o before.html
npx playwright trace snapshot --name after <trace.zip> <call-id> -o after.html

# Serve snapshot on localhost with resources
npx playwright trace snapshot --serve <trace.zip> <call-id>
```

### Screenshots

```bash
# Save the closest screencast frame for an action
npx playwright trace screenshot <trace.zip> <call-id> -o screenshot.png
```

### Attachments

```bash
# List all trace attachments
npx playwright trace attachments <trace.zip>

# Extract an attachment by name
npx playwright trace attachments --save "screenshot-1.png" -o out.png <trace.zip>

# JSON output
npx playwright trace attachments --json <trace.zip>
```

## Typical investigation

```bash
# 1. What happened in this trace?
npx playwright trace info test-results/my-test/trace.zip

# 2. What actions ran?
npx playwright trace list test-results/my-test/trace.zip

# 3. Which action failed?
npx playwright trace list --errors-only test-results/my-test/trace.zip

# 4. What went wrong?
npx playwright trace show test-results/my-test/trace.zip call@12

# 5. What did the page look like?
npx playwright trace snapshot test-results/my-test/trace.zip call@12 -o page.html

# 6. Any relevant network failures?
npx playwright trace network --failed test-results/my-test/trace.zip

# 7. Any console errors?
npx playwright trace console --errors-only test-results/my-test/trace.zip
```
