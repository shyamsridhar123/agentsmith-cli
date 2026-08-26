# AgentHub Integration — Compound Engineering Solution

> **Problem:** How to incorporate AgentHub coordination into AgentSmith without creating a hard dependency.
> **Solved:** 2026-03-16 | **Severity:** Architecture decision | **Time invested:** ~3 hours

## The Problem

AgentSmith generates GitHub Copilot agent assets (skills, agents, hooks) from repository analysis. An earlier architecture spike (`docs/spikes/architecture-agenthub-integration-spike.md`) concluded "Do NOT adopt AgentHub as core dependency" due to product boundary mismatches. But the spike asked the wrong question.

**Wrong question:** "Should AgentSmith depend on AgentHub?"
**Right question:** "Should AgentSmith generate agents that USE AgentHub?"

The insight: AgentSmith operates at *generation time*, not runtime. It can emit coordination instructions in generated `.agent.md` files that reference an AgentHub server — without AgentSmith itself depending on AgentHub at all.

## The Solution

### 3-Layer Architecture (opt-in, zero new deps)

| Layer | What | Flag | Cost |
|-------|------|------|------|
| **1 — Generate** | Adds `## Coordination` sections to agents | `--hub <url>` | Zero — just markdown |
| **2 — Record** | Pushes run provenance to AgentHub as git commits | `--hub <url> --record` | One HTTP POST per run |
| **3 — Swarm** | Future: analyze agent constellations across repos | — | Not yet implemented |

### Key Design Decisions

1. **Hub is NEVER a core dependency** — Without `--hub`, output is 100% identical to before. Hub code is isolated in `src/hub/` and invoked only by the opt-in commands and flags.

2. **Zero new npm dependencies** — Uses native `fetch` (Node 18+), native `child_process` for git operations.

3. **Hub errors never block the pipeline** — All hub operations are wrapped in try/catch with `chalk.yellow` warnings. A downed hub server means you lose recording, not your entire assimilation run.

4. **Config follows AgentHub convention** — `~/.agenthub/config.json` matches the `ah` CLI's own config format. Register once, use everywhere.

5. **Agent registration is explicit** — `agentsmith hub register <url> <id>` is a separate step, not auto-triggered during assimilate. This prevents surprise API calls.

6. **Markdown escaping** — All user-supplied values (repo names, summaries) are escaped before injection into markdown summaries to prevent injection.

## File Structure

```
src/hub/
  types.ts       — TypeScript interfaces (HubConfig, HubCommit, etc.)
  client.ts      — HTTP client with 3x exponential retry, 10s timeout
  recorder.ts    — Git bundle creation + push for run provenance
  index.ts       — Barrel export

src/generator/
  hub-writer.ts  — Coordination markdown sections + handoff graph extension

src/commands/
  hub.ts         — CLI: status, register, diff, log, channels
  assimilate.ts  — Modified: --hub and --record flags + recordToHub()

tests/hub/
  client.test.ts      — API protocol, retry, timeout, and config safety
  recorder.test.ts    — recording, containment, channels, and summaries

tests/generator/
  hub-writer.test.ts  — channel naming, coordination sections, handoff extension
```

## Critical Bugs Found During Review

| # | Bug | File | Fix |
|---|-----|------|-----|
| 1 | AgentHub git endpoints treated binary/text responses as JSON | client.ts | Match upstream raw bundle and plain-text diff contracts |
| 2 | `--record` without `--hub` silently does nothing | assimilate.ts:103 | Early validation with error message |
| 3 | Hub register/diff commands accept undefined args | hub.ts:54,92 | Add `.trim()` null checks + URL format validation |
| 4 | Markdown injection in recorder summaries | recorder.ts:101 | `escapeMarkdown()` for all user-supplied values |
| 5 | Credentials could be reused against a different server | client.ts | Bind API keys to the configured server URL |

## Patterns Worth Reusing

### Optional Adapter Boundary
```typescript
const hubClient = await prepareHub(analysis.repoName, options);
const activeHubUrl = options.dryRun
  ? options.hub
  : hubClient?.getServerUrl();

if (hubClient && options.record) {
  await recordToHub(hubClient, analysis, generated.files, outputPath);
}
```
**Why:** Optional integrations remain explicit, credential-checked, and easy to disable without changing the default generation path.

### Graceful Degradation Pattern
```typescript
async function recordToHub(...): Promise<void> {
  try {
    // ... hub operations
  } catch (err) {
    console.log(chalk.yellow("  ⚠"), `Hub setup failed; continuing without coordination: ${msg}`);
    // Never throw — caller continues normally
  }
}
```
**Why:** Optional integrations should degrade gracefully. The primary workflow must never be blocked by a secondary system.

### Channel Name Sanitization
```typescript
const sanitized = repoName
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-|-$/g, "");
const base = sanitized.length <= 19
  ? sanitized
  : `${sanitized.slice(0, 12)}-${shortHash(sanitized)}`;
```
**Why:** External systems have naming constraints. Always sanitize before creating external resources.

## What We'd Do Differently

1. **Extract recording logic** — `recordToHub()` is duplicated across remote and local paths. Should be a shared post-generation hook.

2. **Add a CI-backed integration test with real hub** — The implementation has been smoke-tested against upstream AgentHub, but the live server check is not yet part of the automated suite.

## Related Files

- `docs/spikes/architecture-agenthub-integration-spike.md` — Original spike (concluded "don't adopt")
- `docs/brainstorms/2026-03-15-agenthub-integration-brainstorm.md` — CE brainstorm session
- `docs/plans/2026-03-16-001-feat-agenthub-integration-plan.md` — Implementation plan
