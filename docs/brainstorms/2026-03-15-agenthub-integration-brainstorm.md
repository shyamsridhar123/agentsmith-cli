# Brainstorm: AgentHub Integration for AgentSmith

**Date:** 2026-03-15
**Status:** Draft
**Participants:** Human + AI (Compound Engineering brainstorm)

## What We're Building

**The spike asked the wrong question.** It asked: "Should AgentSmith _depend on_ AgentHub?"

**The right question is:** "Should AgentSmith _generate agents that use_ AgentHub for coordination?"

AgentSmith **generates** agents. AgentHub **coordinates** agents at runtime. These are complementary, not competing. The integration isn't about making AgentSmith heavier — it's about making the agents it produces **smarter**.

### Three Integration Layers

```
Layer 1: GENERATE → AgentSmith produces agents that know how to talk to AgentHub
Layer 2: RECORD   → AgentSmith logs its own runs to AgentHub for provenance
Layer 3: SWARM    → AgentSmith uses AgentHub to coordinate parallel analysis
```

## Why This Approach

The spike correctly identified that making AgentHub a **core dependency** would be wrong. But it overcorrected by treating it as entirely separate. The insight is:

- **Layer 1 costs nothing** — it's just markdown generation. Zero new dependencies.
- **Layer 2 is opt-in** — `--hub <url>` flag. No hub? No problem.
- **Layer 3 is future** — only matters when AgentSmith gets parallel analysis.

AgentSmith stays zero-friction by default. Power users get coordination superpowers.

## Key Decisions

### Decision 1: Layer 1 — Generated Agent Coordination (ZERO COST)

**What:** When AgentSmith generates a multi-agent constellation, optionally emit coordination instructions so the generated agents know how to use AgentHub.

**How it works:**
```
agentsmith assimilate . --hub http://hub.example.com
```

**What changes:**
- `repo-root.agent.md` gets a "Coordination" section with AgentHub posting patterns
- Each sub-agent gets instructions to log discoveries to channels
- `handoffs.json` gets extended with `coordination.hub` field
- A `post-generate` hook registers agents with AgentHub

**What doesn't change:**
- Without `--hub`, output is identical to today
- No new npm dependencies
- No new runtime requirements
- Generator remains pure string building

**Example generated root agent with hub:**
```markdown
## Coordination

When working on multi-step tasks, coordinate through AgentHub:
- Post hypotheses to `#{{repoName}}-exploration`
- Log analysis results to `#{{repoName}}-results`
- Check `ah leaves` before starting new work to see peer progress
- Push commits for significant findings: `ah push`
```

**Example generated handoffs.json with hub:**
```json
{
  "handoffs": [...],
  "coordination": {
    "hub": "http://hub.example.com",
    "channels": {
      "exploration": "{{repoName}}-exploration",
      "results": "{{repoName}}-results",
      "reviews": "{{repoName}}-reviews"
    }
  }
}
```

### Decision 2: Layer 2 — Run Provenance (OPT-IN)

**What:** Each `agentsmith assimilate` run pushes its output to AgentHub as a commit. Compare runs over time.

**How it works:**
```
agentsmith assimilate . --hub http://hub.example.com --record
```

**Pipeline extension:**
```
Scanner → Analyzer → Generator → Registry → Hooks
                                                ↓
                                          [NEW] HubRecorder
                                                ↓
                                          git bundle push
                                          + post to #runs channel
```

**What gets recorded:**
- Generated files as a git commit (diffable)
- AnalysisResult summary posted to `#runs` channel
- Agent/skill counts, language detected, framework detected
- Timestamp + target repo metadata

**Value:**
- "How did our generated agents change since last week?"
- `ah diff <run-march-10> <run-march-15>` shows exactly what changed
- Audit trail for generated Copilot customizations
- Rollback: `ah fetch <old-run>` to restore previous generation

**Cost:** One new module (`src/hub/recorder.ts`, ~100 LOC). HTTP calls to AgentHub. Zero impact on default path.

### Decision 3: Layer 3 — Swarm Analysis (FUTURE)

**What:** When analyzing large monorepos, spawn multiple analyzer agents that coordinate through AgentHub.

**How it works:**
```
agentsmith assimilate . --hub http://hub.example.com --swarm
```

**Architecture:**
```
                    AgentHub
                   ╱    |    ╲
          channel: #analysis-coordination
                 ╱      |      ╲
    Analyzer-A      Analyzer-B      Analyzer-C
    (backend/)      (frontend/)     (infra/)
        ↓               ↓               ↓
    push findings   push findings   push findings
        ↓               ↓               ↓
                  Orchestrator
                  reads all leaves
                  merges into unified
                  AnalysisResult
                       ↓
                   Generator
                   (single output)
```

**Why AgentHub fits perfectly here:**
- Each analyzer works independently (different directory scopes)
- Push results as commits (diffable, auditable)
- Orchestrator reads `ah leaves` to find all frontier work
- Channel posts for real-time status ("Analyzer-A: found 3 API endpoints")
- Lineage tracks which analyzer produced which findings

**Prerequisites:**
- AgentSmith needs parallel analysis first (not yet built)
- Needs agent spawning capability
- Needs result merging logic

**Timeline:** v0.6+ (after multi-agent constellation is stable)

## Architecture: How the Layers Stack

```
┌──────────────────────────────────────────────────────┐
│                    CLI Interface                      │
│  agentsmith assimilate <target> [--hub URL] [--swarm] │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│              Pipeline Orchestrator                    │
│  assimilate.ts (existing, extended with hub hooks)    │
└──────────────┬───────────────────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│Scanner │ │Analyzer│ │  Hub   │ ← NEW (opt-in)
│        │ │(local/ │ │Adapter │
│        │ │remote) │ │        │
└────┬───┘ └────┬───┘ └────┬───┘
     │          │          │
     ▼          ▼          ▼
┌──────────────────────────────────────────────────────┐
│                    Generator                          │
│  (extended: if --hub, emit coordination sections)     │
└──────────────┬───────────────────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌──────────┐
│Registry│ │ Hooks  │ │   Hub    │ ← NEW (opt-in)
│.jsonl  │ │.yaml   │ │ Recorder │
└────────┘ └────────┘ └──────────┘
```

## New Modules Required

| Module | Layer | LOC Est. | Dependencies | Purpose |
|--------|-------|----------|--------------|---------|
| `src/hub/client.ts` | Shared | ~80 | `fetch` (built-in) | HTTP client for AgentHub API |
| `src/hub/recorder.ts` | L2 | ~100 | hub/client | Push run results as commits |
| `src/hub/coordinator.ts` | L3 | ~150 | hub/client | Swarm coordination logic |
| `src/generator/hub-writer.ts` | L1 | ~60 | None | Emit coordination markdown |
| `src/commands/hub.ts` | CLI | ~50 | hub/client | `agentsmith hub status/diff/log` |

**Total new code:** ~440 LOC across 5 files. Zero new npm dependencies.

## CLI Surface

```bash
# Default (unchanged)
agentsmith assimilate .

# Layer 1: Generate agents with coordination awareness
agentsmith assimilate . --hub http://hub.example.com

# Layer 2: Record run provenance
agentsmith assimilate . --hub http://hub.example.com --record

# Layer 3: Swarm analysis (future)
agentsmith assimilate . --hub http://hub.example.com --swarm

# Hub management commands
agentsmith hub status                    # Check hub connectivity
agentsmith hub diff <run-a> <run-b>      # Compare two runs
agentsmith hub log [--limit 10]          # Recent runs
agentsmith hub channels                  # List coordination channels
```

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| AgentHub API changes | Medium | Low | Thin adapter pattern; isolate in `src/hub/` |
| Hub unavailable at runtime | Medium | None | Graceful degradation; `--hub` is opt-in |
| Generated agents confuse users with hub instructions | Low | Medium | Only emit when `--hub` explicitly passed |
| Security of hub URL in generated files | Medium | Medium | Document; don't include API keys in generated md |
| Scope creep into "platform" territory | Medium | High | Hard boundary: AgentSmith generates, doesn't host |

## Resolved Questions

1. **Auto-create channels on the hub?** ✅ **YES** — `agentsmith assimilate --hub` auto-creates channels like `#myrepo-exploration`, `#myrepo-results`, `#myrepo-reviews`.
2. **Separate npm package for hub client?** ✅ **NO** — stays internal in `src/hub/` as a module. Simpler, fewer moving parts.
3. **Agent registration flow?** ✅ **Separate step** — user runs `agentsmith hub register` explicitly. Keeps assimilate fast and predictable.
4. **Recorded run contents?** ✅ **Full contents** — push all generated files as a git commit. Heaviest but most useful for `ah diff` comparisons.
5. **Hub auth in generated agents?** ✅ **Config file** — generated agents reference `~/.agenthub/config.json`. Consistent with AgentHub's own `ah` CLI conventions.

## Success Criteria

- [ ] `agentsmith assimilate .` (no hub) works identically to today
- [ ] `agentsmith assimilate . --hub <url>` generates coordination-aware agents
- [ ] `agentsmith assimilate . --hub <url> --record` logs run to hub
- [ ] `agentsmith hub diff` shows meaningful comparison between runs
- [ ] Zero new npm dependencies added
- [ ] <500 LOC total for Layers 1+2

---

_Next: Resolve open questions → `/ce:plan` for implementation_
