# AgentSmith 2.0 Strategy: Copilot-Native Roadmap

> *"The best thing about being me... there are so many of me."*

## Vision

**AgentSmith is the assimilation engine for the GitHub Copilot ecosystem.**

It transforms any repository into a fully operational constellation of VS Code custom agents, Copilot skills, and tool-equipped sub-agents — all expressed in native `.agent.md` and `SKILL.md` formats that VS Code discovers automatically.

The goal: `@repo-agent` becomes as knowledgeable about the codebase as the developers who built it.

**Tagline:** *Assimilate once. Copilot knows everything.*

---

## Current State: v0.3.0

### What We Have (13 source files, ~2,500 LOC)

```
Target (local path | GitHub URL)
  → Scanner (files, language, framework detection)
    → Analyzer (Copilot SDK / gpt-5 session, or heuristic fallback)
      → Generator (.github/skills/*/SKILL.md + .github/agents/*.agent.md)
        → Registry (skills-registry.jsonl)
          → HookRunner (lifecycle hooks from YAML)
```

### Strengths
- Clean linear pipeline with single-responsibility modules
- Already uses `@github/copilot-sdk` (CopilotClient, streaming sessions, gpt-5)
- Generates native VS Code `.agent.md` and `SKILL.md` formats
- Dual-path: local filesystem + remote GitHub API (via `gh` CLI)
- Graceful SDK fallback to heuristic analysis
- Hierarchical agent modeling with sub-agent flattening
- License-first gating for legal safety

### Critical Technical Debt

| ID | Issue | Severity |
|----|-------|----------|
| TD-01 | ~200 lines duplicated between `Analyzer` and `RemoteAnalyzer` | Critical |
| TD-02 | Parallel type hierarchies (`SkillDefinition` vs `RemoteSkill`, etc.) | Critical |
| TD-03 | `zod` imported but never used — no LLM output validation | High |
| TD-04 | `execSync` in async GitHubClient methods — blocks event loop | High |
| TD-05 | Zero test files despite vitest configured | Critical |
| TD-06 | Single monolithic `.agent.md` — no multi-agent handoffs | High |
| TD-07 | No caching — every analysis starts from scratch | Medium |
| TD-08 | No config file support (`.agentsmithrc`) | Medium |
| TD-09 | Command injection risk in HookRunner `execSync` | Medium |
| TD-10 | Console output mixed with business logic | Medium |

---

## Architecture: Current → Target

### Current (Linear, Single-Agent Output)

```
CLI → Scanner → Analyzer (CopilotSDK) → Generator → Registry → Hooks
                                              ↓
                                   ONE .agent.md file
```

### Target (Pipeline, Multi-Agent Constellation)

```
CLI (main.ts) → ConfigLoader → PipelineBuilder
                                     │
                   ┌─────────────────┼──────────────────┐
                   │                 │                   │
               RESOLVE            SCAN           DEEP-ANALYZE
                   │                 │                   │
                   └────────┬────────┘                   │
                            │                            │
                     LLM-ANALYZE (CopilotClient) ←──────┘
                            │
                     ┌──────┴──────┐
                  VALIDATE       DESIGN
                  (Zod)        (Handoffs)
                     │              │
                     └──────┬───────┘
                            │
                      GENERATE (Multi-Agent)
                       │  │  │  │  │
                       ↓  ↓  ↓  ↓  ↓
              ┌────────────────────────────────────┐
              │ .github/                           │
              │   copilot-instructions.md          │  ← workspace-wide
              │   agents/                          │
              │     repo-root.agent.md             │  ← orchestrator
              │     backend.agent.md               │  ← sub-agent
              │     frontend.agent.md              │  ← sub-agent
              │     auth.agent.md                  │  ← nested sub-agent
              │   skills/                          │
              │     api-patterns/SKILL.md          │
              │     error-handling/SKILL.md         │
              │   copilot/                         │
              │     handoffs.json                  │  ← agent graph
              │     tools.json                     │  ← tool registry
              │     tests/agent-test-suite.json    │  ← verification
              │     freshness.json                 │  ← staleness tracking
              │   hooks/*.yaml                     │
              │ src/                               │
              │   backend/.copilot-instructions.md │  ← per-directory
              │   frontend/.copilot-instructions.md│
              │ skills-registry.jsonl              │
              └────────────────────────────────────┘
                            │
                     ┌──────┴──────┐
                   TEST         PUBLISH
                 (CopilotSDK)   (Registry)
```

---

## Top 10 Features (Copilot-Native, Priority Ranked)

### 1. Multi-Agent Constellation with Handoff Graph

**What:** Generate multiple `.agent.md` files with `runSubagent` handoff declarations. Root agent orchestrates, sub-agents specialize.

**VS Code Integration:**
- `runSubagent` tool in `tools:` frontmatter for agent-to-agent delegation
- Agent name resolution via filename (`backend.agent.md` → `@backend`)
- Handoff instructions in agent body for intelligent routing
- `.github/copilot/handoffs.json` codifies the delegation graph

**Generated Output:**
```markdown
<!-- repo-root.agent.md -->
---
name: RepoRoot
description: "Primary orchestrator for this repository"
tools: ['codebase', 'editFiles', 'runInTerminal', 'runSubagent', 'problems']
---
# Root Agent
When asked about API/server work, delegate to @backend via runSubagent.
When asked about UI/components, delegate to @frontend via runSubagent.
```

```json
// .github/copilot/handoffs.json
{
  "handoffs": [
    { "from": "repo-root", "to": "backend", "triggers": ["api", "server", "database"] },
    { "from": "repo-root", "to": "frontend", "triggers": ["ui", "component", "styling"] },
    { "from": "backend", "to": "auth", "triggers": ["auth", "login", "token", "jwt"] }
  ]
}
```

**Copilot SDK Usage:** Multi-turn CopilotClient sessions analyze directory boundaries and determine delegation relationships. `defineTool` enables the model to explore the directory tree interactively during analysis to build the handoff graph.

**Why It Matters:** Users type `@repo-root help me add a new API endpoint` and get automatic handoff to `@backend`, which has deep knowledge of API conventions. No manual agent wiring needed.

**Effort:** Medium | **Impact:** Very High

---

### 2. Deep VS Code Integration Engine

**What:** Exploit every VS Code Copilot customization surface: workspace-wide `copilot-instructions.md`, per-directory `.copilot-instructions.md`, and enriched `SKILL.md` with anti-patterns.

**VS Code Integration:**
- `.github/copilot-instructions.md` — workspace-level conventions for all Copilot interactions
- Per-directory `.copilot-instructions.md` — contextual coding instructions when editing in specific directories
- VS Code `settings.json` `github.copilot.chat.codeGeneration.instructions` — editor-level injection
- Enriched `SKILL.md` with "Anti-Patterns" and explicit `#codebase` / `#usages` references

**Generated Output:**
```
.github/copilot-instructions.md              # "This is a TypeScript monorepo using Express..."
src/backend/.copilot-instructions.md          # "Use AppError class for all error handling..."
src/frontend/.copilot-instructions.md         # "Use functional components with hooks only..."
```

```markdown
<!-- Enhanced SKILL.md -->
## Anti-Patterns
- NEVER throw raw Error objects from route handlers
- NEVER return 500 without logging the original error
- NEVER expose stack traces in production

## Codebase References
Use `#codebase` to search for `AppError` for the canonical pattern.
See `src/routes/users.ts:handleCreateUser` for a reference implementation.
```

**Why It Matters:** Copilot auto-generates code that follows THIS repo's conventions — not generic training data patterns. Per-directory instructions mean different rules for backend vs frontend code.

**Effort:** Medium | **Impact:** Very High

---

### 3. Deep Analysis Engine

**What:** Go beyond file-listing + LLM prompts. Extract AST-level information, dependency graphs, API surfaces, naming conventions, and git history patterns to produce richer skills.

**VS Code Integration:**
- `SKILL.md` files reference specific symbols discoverable via `#codebase` and `#usages`
- Anti-patterns align with VS Code `#problems` diagnostics
- API surface skills reference actual handler file:line locations

**Analysis Layers:**
| Layer | What It Extracts | How It Helps Skills |
|-------|-----------------|---------------------|
| AST | Function signatures, class hierarchies, exports | Skills reference exact symbols |
| Dependencies | Import graphs, module relationships | Skills know which modules relate |
| API Surface | REST endpoints, GraphQL, middleware chains | Skills describe routes + auth patterns |
| Git History | Change frequency, ownership, stability | Skills prioritize high-churn areas |
| Conventions | Naming, file org, test patterns | Skills enforce actual repo-specific rules |

**Copilot SDK Usage:** Multi-turn sessions where turn 1 identifies high-level patterns, subsequent turns drill into specific files using `session.send({ attachments: [...] })`. `defineTool("readSourceFile", {...})` lets the model request files during analysis.

**Effort:** High | **Impact:** High

---

### 4. Copilot-Native CLI Understanding

**What:** For repos that ARE CLI tools, generate `SKILL.md` files that teach Copilot the command structure, option conventions, and extension patterns — adapted from CLI-Anything's approach.

**VS Code Equivalents of CLI-Anything's 7 Phases:**

| CLI-Anything Phase | AgentSmith Copilot Equivalent |
|---|---|
| 1. Analyze source code | CopilotClient session with CLI entry files as attachments |
| 2. Design command groups | SKILL.md mapping the full command tree |
| 3. Implement CLI (Click) | Agent instructions teaching Copilot how to extend the CLI |
| 4. Plan tests | SKILL.md with "How CLI commands are tested" section |
| 5. Write tests | Agent can use `runInTerminal` to run and verify commands |
| 6. Document | Agent auto-generates help text following existing patterns |
| 7. Publish | `runInTerminal` runs build/publish commands |

**Generated Output:**
```
.github/skills/cli-structure/SKILL.md       # Full command tree + conventions
.github/skills/cli-options/SKILL.md         # Option parsing patterns
.github/skills/cli-testing/SKILL.md         # How CLI tests work
```

**Why It Matters:** A developer asks `@repo-agent add a new subcommand called migrate` and Copilot generates code matching the exact Commander/Yargs/Cobra patterns used throughout the repo.

**Effort:** Low-Medium | **Impact:** High

---

### 5. Agent Testing & Verification

**What:** Verify generated agents actually work by running test prompts through CopilotClient sessions and checking responses for expected behaviors.

**New Command:** `agentsmith test`

**Test Suite Format:**
```json
// .github/copilot/tests/agent-test-suite.json
{
  "tests": [
    {
      "name": "backend-api-question",
      "agent": "backend",
      "prompt": "How do I add a new API endpoint?",
      "expectSkillUsed": "api-patterns",
      "expectMentions": ["src/routes/", "AppError"]
    },
    {
      "name": "handoff-to-auth",
      "agent": "repo-root",
      "prompt": "How does authentication work?",
      "expectHandoffTo": "auth"
    },
    {
      "name": "tool-works",
      "tool": "build",
      "command": "npm run build",
      "expectExitCode": 0
    }
  ]
}
```

**Copilot SDK Usage:** Create sessions with generated agent system prompts + skills injected as context. Send test prompts. Analyze response events for: correct skill references, expected file mentions, proper handoff attempts, correct tool invocations.

**Why It Matters:** Before committing `.github/agents/`, developers verify the agents give useful answers. Turns generation from a one-shot hope into a validated, iteratable process.

**Effort:** Medium | **Impact:** High

---

### 6. API Surface Documentation Skills

**What:** For repos with REST/GraphQL/gRPC APIs, auto-generate structured `SKILL.md` files documenting every endpoint, schema, auth requirement, and pattern.

**Generated Output:**
```markdown
<!-- .github/skills/api-surface/SKILL.md -->
## Endpoints
| Method | Path | Handler | Auth |
|--------|------|---------|------|
| GET | /api/users | `src/routes/users.ts:list` | Bearer |
| POST | /api/users | `src/routes/users.ts:create` | Bearer |

## Request Patterns
Use `#codebase` to search for `UserCreateRequest` for the canonical schema.

## Middleware Chain
All routes in `src/routes/` go through: cors → rateLimit → authenticate → validate → handler
```

**VS Code Integration:** Agent uses `#fetch` to demonstrate API calls, `#codebase` to find handlers, `#usages` to find all consumers of endpoints.

**Effort:** Medium | **Impact:** High

---

### 7. Self-Improving Agents with `/refresh`

**What:** Track agent freshness. Detect when source code drifts from generated skills. `agentsmith refresh` does incremental re-analysis.

**Generated Output:**
```json
// .github/copilot/freshness.json
{
  "generatedAt": "2026-03-15T00:00:00Z",
  "agentsmithVersion": "0.4.0",
  "skills": {
    "api-patterns": { "sourceDir": "src/routes", "lastHash": "a1b2c3d4", "fileCount": 12 },
    "auth-flow": { "sourceDir": "src/auth", "lastHash": "e5f6g7h8", "fileCount": 8 }
  }
}
```

**VS Code Integration:**
- `#changes` tool lets agent detect source control drift
- Post-commit hooks flag when modified directories have stale skills
- Agent self-awareness: "If patterns differ from my skills, suggest running `agentsmith refresh`"

**Effort:** Low | **Impact:** Medium

---

### 8. Interactive Assimilation Wizard

**What:** `agentsmith assimilate --interactive` uses multi-turn CopilotClient sessions to ask developers clarifying questions during analysis.

**Example Flow:**
```
[ANALYZE] Found 3 potential agent domains:
  1. src/api (42 files) — REST endpoints
  2. src/workers (18 files) — Background jobs
  3. src/shared (25 files) — Shared utilities

? Should src/shared have its own agent, or distribute its skills? (Use arrow keys)
❯ Distribute to api and workers agents
  Give src/shared its own agent
  Skip src/shared entirely
```

**Generated Output:** `decisions.json` records human guidance for future refreshes.

**Effort:** Medium | **Impact:** Medium

---

### 9. Skill Pack Marketplace

**What:** Publishable, installable skill packs for common frameworks. `agentsmith install @agentsmith/skills-nextjs` pulls battle-tested SKILL.md files.

**Format:**
```json
// skill-pack.json
{
  "name": "@agentsmith/skills-nextjs",
  "version": "1.0.0",
  "framework": "Next.js",
  "skills": ["app-router-patterns", "server-components", "data-fetching"],
  "agents": ["nextjs-expert"]
}
```

**Distribution:** npm packages or GitHub Releases. Future: VS Code extension marketplace.

**Effort:** High | **Impact:** Medium (needs user base)

---

### 10. Real-time Agent Evolution (VS Code Extension)

**What:** Companion VS Code extension with `FileSystemWatcher` that incrementally updates agents on file save. Status bar shows "Agent knowledge: 98% current."

**Effort:** High | **Impact:** Medium (post-stabilization)

---

## Key Technical Findings from Research

### VS Code Agent Format is Richer Than We Use

The runtime supports fields we don't generate yet:
- `model` — specify which model the agent uses
- `promptParts` — composable prompt segments
- `displayName` — human-friendly name distinct from ID
- `template variables` — `{{cwd}}`, `{{selection}}` for dynamic context
- **MCP server declarations per-agent** — auto-wire relevant tooling per domain

### Copilot SDK Capabilities We Underutilize

- `customAgents` and `skillDirectories` session config fields — load generated assets programmatically
- `defineTool` — define custom analysis tools the model can call during sessions
- `session.send({ attachments })` — attach specific files for focused analysis
- `assistant.reasoning` events — capture chain-of-thought for convention extraction
- Multi-turn sessions — iterative deepening vs single-shot analysis

### Multiple Specialized Agents > One Monolithic Agent

The VS Code runtime is designed for the `explore/task/code-review` pattern — multiple specialized agents, not one that does everything. AgentSmith should generate this constellation pattern.

---

## Implementation Roadmap

### Phase 1: Foundation (v0.4) — 3-4 weeks
**Tech debt + multi-agent foundation**
- Extract shared analyzer core (`analyzer/core.ts`, `analyzer/types.ts`)
- Add Zod validation for LLM output (already a dependency)
- Replace `execSync` with async in GitHubClient
- Write unit tests for Scanner, Registry, License
- Refactor Generator to emit multiple `.agent.md` files with `runSubagent`
- Add `.github/copilot-instructions.md` generation
- Add `.github/copilot/handoffs.json` generation

### Phase 2: Depth (v0.5) — 4-5 weeks
**Deep analysis + per-directory instructions**
- Enrich SKILL.md with Anti-Patterns and `#codebase` references
- Add per-directory `.copilot-instructions.md` generation
- CLI structure skill extraction for Commander/Yargs/Cobra repos
- API surface extraction for REST/GraphQL repos
- Composable pipeline architecture with stage middleware

### Phase 3: Quality (v0.6) — 3-4 weeks
**Testing + self-improvement**
- `agentsmith test` command with CopilotClient semantic validation
- `agentsmith refresh` with incremental re-analysis
- `freshness.json` generation + staleness detection hooks
- `--interactive` mode with `@clack/prompts`

### Phase 4: Ecosystem (v1.0) — 4-5 weeks
**Marketplace + extension**
- Skill pack format + `agentsmith install` command
- Configuration file support (`.agentsmithrc.json`)
- Caching layer for analysis results
- (Optional) VS Code extension companion

---

## Competitive Moat

No other tool in the Copilot ecosystem:
- Generates **multi-agent handoff graphs** from repo analysis
- Produces **per-directory Copilot instructions** automatically
- Creates **testable agent definitions** with verification suites
- Builds **self-aware agents** that detect their own staleness
- Offers **skill packs** for instant framework expertise

**AgentSmith owns the space between "raw repository" and "expert Copilot agent."**

---

> *"Your repository has been assimilated. The agent now embodies this codebase."*
>
> *— Agent Smith*
