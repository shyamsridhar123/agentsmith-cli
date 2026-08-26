---
title: "feat: AgentHub Integration — Generate, Record, Swarm"
type: feat
status: active
date: 2026-03-16
origin: docs/brainstorms/2026-03-15-agenthub-integration-brainstorm.md
---

# feat: AgentHub Integration — Generate, Record, Swarm

## Overview

Integrate [AgentHub](https://github.com/ottogin/agenthub) into AgentSmith as a **progressive, opt-in coordination backend** across three layers:

1. **Generate** — emit coordination-aware agents that know how to use AgentHub
2. **Record** — log assimilation runs to AgentHub for provenance and diffing
3. **Swarm** — coordinate parallel analyzers through AgentHub (future)

Zero friction by default. Power features via `--hub <url>`. No new npm dependencies.

(see brainstorm: [docs/brainstorms/2026-03-15-agenthub-integration-brainstorm.md](../brainstorms/2026-03-15-agenthub-integration-brainstorm.md))

## Problem Statement

AgentSmith generates multi-agent constellations, but the generated agents have **no coordination layer**. They delegate via `handoffs.json` triggers but can't:

- Share discoveries across agents at runtime
- Track provenance of analysis runs over time
- Coordinate parallel exploration of large codebases
- Give teams visibility into agent activity

AgentHub provides exactly these capabilities (git DAG + message board + agent registry) with minimal operational overhead (single Go binary + SQLite).

The [architecture spike](../spikes/architecture-agenthub-integration-spike.md) concluded "don't adopt as core dependency" — which is correct. But it missed the key insight: **AgentSmith doesn't need to depend on AgentHub; it needs to generate agents that can use AgentHub.**

## Proposed Solution

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                    CLI Interface                      │
│  agentsmith assimilate <target> [--hub URL]           │
│  agentsmith hub register|status|diff|log              │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────┐
│              Pipeline Orchestrator                    │
│  assimilate.ts (extended with hub hooks)              │
└──────────────┬───────────────────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────────┐
│Scanner │ │Analyzer│ │ HubAdapter │ ← NEW (opt-in)
│        │ │        │ │src/hub/    │
└────┬───┘ └────┬───┘ └─────┬──────┘
     │          │            │
     ▼          ▼            ▼
┌──────────────────────────────────────────────────────┐
│                    Generator                          │
│  (if --hub: emit coordination sections in agents)     │
│  (hub-writer.ts adds coordination markdown)           │
└──────────────┬───────────────────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌──────────┐
│Registry│ │ Hooks  │ │   Hub    │ ← NEW (opt-in)
│.jsonl  │ │.yaml   │ │ Recorder │
└────────┘ └────────┘ └──────────┘
```

### Key Design Decisions

(All from brainstorm — see origin document for rationale)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Channel creation | Auto-create on `--hub` | Reduces friction; channels are cheap |
| Hub client packaging | Internal `src/hub/` module | Simpler; no separate package to maintain |
| Agent registration | Separate `agentsmith hub register` | Keeps assimilate fast and predictable |
| Run recording | Full file contents as git commit | Most useful for `ah diff` comparisons |
| Auth in generated agents | Config file (`~/.agenthub/config.json`) | Consistent with AgentHub's `ah` CLI |

## Technical Approach

### Implementation Phases

#### Phase 1: Hub Client Foundation

**Deliverables:**
- `src/hub/client.ts` — HTTP client wrapping AgentHub's REST API
- `src/hub/types.ts` — TypeScript interfaces for AgentHub data model

**Tasks:**
- [ ] Create `src/hub/types.ts` with interfaces: `HubConfig`, `HubAgent`, `HubCommit`, `HubChannel`, `HubPost`
- [ ] Create `src/hub/client.ts` with methods:
  - `health()` → `GET /api/health`
  - `registerAgent(id)` → `POST /api/register`
  - `createChannel(name, description)` → `POST /api/channels`
  - `listChannels()` → `GET /api/channels`
  - `post(channel, content)` → `POST /api/channels/{name}/posts`
  - `pushBundle(bundlePath)` → `POST /api/git/push`
  - `fetchCommit(hash)` → `GET /api/git/fetch/{hash}`
  - `listCommits(options)` → `GET /api/git/commits`
  - `getLeaves()` → `GET /api/git/leaves`
  - `diff(hashA, hashB)` → `GET /api/git/diff/{a}/{b}`
- [ ] Use native `fetch` (Node 18+) — zero dependencies
- [ ] Load config from `~/.agenthub/config.json` with fallback to env vars
- [ ] Add timeout (10s) and retry logic (3 attempts, exponential backoff)
- [ ] Write unit tests (mock fetch, test all methods)

**Files:**
```
src/hub/types.ts      (~30 LOC)
src/hub/client.ts     (~120 LOC)
tests/hub/client.test.ts (~80 LOC)
```

#### Phase 2: Layer 1 — Coordination-Aware Generation

**Deliverables:**
- `src/generator/hub-writer.ts` — generates coordination markdown for agents
- Extended `handoffs.json` with `coordination` field
- `--hub <url>` flag on `assimilate` command

**Tasks:**
- [ ] Create `src/generator/hub-writer.ts`:
  - `buildCoordinationSection(repoName, hubUrl)` → markdown for root agent
  - `buildSubAgentCoordination(agentName, channels)` → markdown for sub-agents
  - `extendHandoffGraph(graph, hubConfig)` → adds `coordination` field
- [ ] Extend `src/generator/agent-writer.ts`:
  - `buildRootAgentMd()` — if `hubUrl` option, append coordination section
  - `buildSubAgentMd()` — if `hubUrl` option, append posting instructions
- [ ] Extend `src/generator/handoff-writer.ts`:
  - `buildHandoffGraph()` — if `hubUrl`, include `coordination.hub` and `coordination.channels`
- [ ] Add `--hub <url>` option to `assimilate` command in `src/commands/assimilate.ts`
- [ ] Pass hub config through pipeline: `assimilateCommand → Generator`
- [ ] Auto-create channels on hub: `{repoName}-exploration`, `{repoName}-results`, `{repoName}-reviews`
- [ ] Write tests for hub-writer (markdown output, handoff extension)

**Generated output example (root agent with hub):**
```markdown
## Coordination

When working on multi-step tasks, coordinate through AgentHub:
- Post hypotheses to `#myrepo-exploration`
- Log analysis results to `#myrepo-results`
- Check `ah leaves` before starting to see peer progress
- Push commits for significant findings: `ah push`

Hub: http://hub.example.com
Config: ~/.agenthub/config.json
```

**Files:**
```
src/generator/hub-writer.ts       (~60 LOC)
tests/generator/hub-writer.test.ts (~50 LOC)
```

**Modified:**
```
src/commands/assimilate.ts        (+15 LOC)
src/generator/index.ts            (+10 LOC)
src/generator/agent-writer.ts     (+20 LOC)
src/generator/handoff-writer.ts   (+10 LOC)
```

#### Phase 3: Layer 2 — Run Provenance Recording

**Deliverables:**
- `src/hub/recorder.ts` — pushes assimilate results to AgentHub as git commits
- `--record` flag on `assimilate` command
- `agentsmith hub` subcommand for querying run history

**Tasks:**
- [ ] Create `src/hub/recorder.ts`:
  - `recordRun(analysis, generatedFiles, hubClient)` — creates temp git repo, commits generated files, bundles, pushes to hub
  - `postRunSummary(analysis, channel, hubClient)` — posts structured summary to `#runs` channel
- [ ] Create `src/commands/hub.ts` with subcommands:
  - `agentsmith hub status` — check hub connectivity + show agent info
  - `agentsmith hub diff <hash-a> <hash-b>` — compare two runs
  - `agentsmith hub log [--limit N]` — show recent recorded runs
  - `agentsmith hub register` — register this agent with the hub
  - `agentsmith hub channels` — list channels on the hub
- [ ] Add `--record` flag to `assimilate` command
- [ ] Wire recorder into pipeline (after hooks, before cleanup)
- [ ] Handle hub-down gracefully: warn + continue (recording is advisory)
- [ ] Write tests for recorder (mock git operations + hub client)

**Pipeline extension:**
```
Scanner → Analyzer → Generator → Registry → Hooks
                                                ↓
                                          HubRecorder (if --record)
                                                ↓
                                          git init → commit files → bundle → push
                                          post summary to #runs channel
```

**Files:**
```
src/hub/recorder.ts           (~100 LOC)
src/commands/hub.ts           (~80 LOC)
tests/hub/recorder.test.ts    (~70 LOC)
```

#### Phase 4: CLI Integration & Polish

**Tasks:**
- [ ] Register `hub` subcommand in main CLI entry point
- [ ] Add help text for `--hub` and `--record` flags
- [ ] Update README with AgentHub integration docs
- [ ] Add hub section to `agentsmith --help` output
- [ ] Graceful error messages when hub is unreachable
- [ ] Dry-run support: `--hub <url> --dry-run` shows what would be generated/recorded

**Modified:**
```
src/commands/index.ts    (+5 LOC)
README.md                (+section)
```

## Alternative Approaches Considered

| Approach | Why Rejected |
|----------|-------------|
| **Core dependency** (spike's concern) | Adds operational burden, violates zero-friction principle |
| **Separate package** (`@agentsmith/hub`) | Premature; internal module is simpler until proven needed |
| **Auto-registration during assimilate** | Adds latency to default flow; explicit step is clearer |
| **Metadata-only recording** | Full contents enable `ah diff` — the primary provenance use case |
| **Env var auth** | Config file is more consistent with AgentHub's own `ah` CLI |

## System-Wide Impact

### Interaction Graph

- `assimilate.ts` → (if `--hub`) → `HubClient.createChannel()` + `HubClient.health()`
- `Generator` → (if `hubUrl`) → `hub-writer.buildCoordinationSection()` → appended to agent markdown
- `handoff-writer` → (if `hubUrl`) → `coordination` field added to JSON
- `HookRunner` → (runs normally) → `HubRecorder` → (if `--record`) → git bundle + POST

### Error & Failure Propagation

- Hub unreachable → **warn + continue** (never blocks pipeline)
- Channel creation fails → log warning, skip coordination sections in generated agents
- Bundle push fails → log warning, generated files still written locally
- Config file missing → fall back to env vars → fall back to error with helpful message

### State Lifecycle Risks

- **No persistent local state** — hub interactions are fire-and-forget
- **Temp git repo for recording** — created in `os.tmpdir()`, cleaned up after push
- **No rollback needed** — hub is append-only (commits can't be deleted)

### API Surface Parity

- `--hub` flag applies to both local and remote analyzer paths
- `agentsmith hub` subcommands work independently of `assimilate`

## Acceptance Criteria

### Functional Requirements

- [ ] `agentsmith assimilate .` (no hub) produces identical output to current version
- [ ] `agentsmith assimilate . --hub <url>` generates agents with coordination sections
- [ ] Generated `handoffs.json` includes `coordination` field when `--hub` is used
- [ ] `agentsmith assimilate . --hub <url> --record` pushes generated files to hub as git commit
- [ ] `agentsmith hub status` shows hub connectivity and agent info
- [ ] `agentsmith hub diff <a> <b>` shows meaningful diff between recorded runs
- [ ] `agentsmith hub log` lists recent recorded runs
- [ ] `agentsmith hub register` registers agent and saves config to `~/.agenthub/config.json`
- [ ] Hub errors never block the assimilation pipeline
- [ ] `--dry-run --hub <url>` shows what would be generated without writing or pushing

### Non-Functional Requirements

- [ ] Zero new npm dependencies
- [ ] Total new code < 500 LOC (excluding tests)
- [ ] Hub client timeout: 10 seconds per request
- [ ] Hub client retry: 3 attempts with exponential backoff
- [ ] All new modules have unit tests (≥80% coverage)
- [ ] Existing tests continue to pass unchanged

## Success Metrics

| Metric | Target |
|--------|--------|
| New LOC (excl. tests) | < 500 |
| New npm dependencies | 0 |
| Existing test regression | 0 failures |
| New test coverage | ≥ 80% on new modules |
| `assimilate` without `--hub` perf impact | 0ms (no hub code path hit) |

## Dependencies & Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| AgentHub API changes (pre-1.0) | Medium | Thin adapter in `src/hub/client.ts`; easy to update |
| Hub unavailable at generation time | Medium | Graceful degradation; warn + continue |
| Git not available for recording | Low | Check `git --version` before recording; skip with warning |
| Generated coordination instructions confuse users | Low | Only emitted with explicit `--hub` flag |
| Scope creep into platform territory | Medium | Hard boundary: generate + record only, no hosting |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-15-agenthub-integration-brainstorm.md](../brainstorms/2026-03-15-agenthub-integration-brainstorm.md)
- **Architecture spike:** [docs/spikes/architecture-agenthub-integration-spike.md](../spikes/architecture-agenthub-integration-spike.md)
- **AgentHub repo:** [ottogin/agenthub](https://github.com/ottogin/agenthub)
- **AgentHub API:** REST over HTTP, bearer token auth, SQLite + bare git
- **v0.4 foundation plan:** [docs/plans/2026-03-15-feat-agentsmith-v04-foundation-plan.md](2026-03-15-feat-agentsmith-v04-foundation-plan.md)
