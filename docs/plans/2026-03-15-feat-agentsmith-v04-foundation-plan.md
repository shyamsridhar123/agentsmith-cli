---
title: "feat: AgentSmith v0.4 Foundation — Multi-Agent Constellation & Tech Debt Resolution"
type: feat
status: active
date: 2026-03-15
origin: docs/STRATEGY-v2.md
---

# AgentSmith v0.4 Foundation — Multi-Agent Constellation & Tech Debt Resolution

## Overview

Transform AgentSmith from a single-agent generator into a multi-agent constellation engine for the GitHub Copilot + VS Code ecosystem. Phase 1 (v0.4) resolves critical technical debt while establishing the foundation for multi-agent handoff graphs, workspace-wide Copilot instructions, and Zod-validated LLM output — all native to VS Code's `.agent.md` and `SKILL.md` discovery system.

**Origin strategy:** [docs/STRATEGY-v2.md](../STRATEGY-v2.md) — Copilot-Native Roadmap, Phase 1 specification.

## Problem Statement / Motivation

AgentSmith v0.3.0 generates a **single monolithic `.agent.md`** file per repository. The VS Code Copilot runtime is designed for the `explore/task/code-review` pattern — multiple specialized agents with delegation, not one that does everything. Key problems:

1. **~200 lines duplicated** between `Analyzer` (677 LOC) and `RemoteAnalyzer` (612 LOC) — both exceed the 500-line architectural limit
2. **Parallel type hierarchies** (`SkillDefinition` vs `RemoteSkill`, etc.) make changes error-prone
3. **Zod is imported but never used** — LLM output from `@github/copilot-sdk` sessions goes unvalidated, causing silent failures
4. **`execSync` in async GitHubClient** blocks the Node.js event loop during remote analysis
5. **Zero test files** despite vitest configured — no safety net for refactoring
6. **No `copilot-instructions.md`** generation — missing the most impactful VS Code customization surface
7. **No handoff graph** — `runSubagent` tool declarations and `handoffs.json` not generated

Users typing `@repo-agent help me add a new API endpoint` should get automatic handoff to `@backend`, which has deep knowledge of API conventions. Today they get a single generic agent.

## Proposed Solution

Five deliverables executed in dependency order:

| ID | Deliverable | Depends On | Strategy Ref |
|----|-------------|------------|--------------|
| D1 | Shared Analyzer Core + Unified Types | — | TD-01, TD-02 |
| D2 | Zod Validation Schemas for LLM Output | D1 | TD-03 |
| D3a | Async GitHubClient (replace `execSync`) | — | TD-04 |
| D3b | Unit Test Suite (Scanner, Registry, License, Generator) | D1 | TD-05 |
| D4 | Multi-Agent Constellation Generator | D1, D2 | Feature #1 |
| D5 | Copilot Instructions Generation | D4 | Feature #2 |

## Technical Approach

### Architecture

#### Current (Linear, Single-Agent)

```
CLI -> Scanner -> Analyzer (CopilotSDK) -> Generator -> Registry -> Hooks
                                              |
                                   ONE .agent.md file
```

#### Target (v0.4 — Multi-Agent with Shared Core)

```
CLI -> Scanner -> Analyzer/Core -------> Zod Validation
                    |                       |
              +-----------+                 |
          LocalAnalyzer  RemoteAnalyzer     |
              +-----+-----+                 |
                    | <---------------------+
              MultiAgentGenerator
               |  |  |  |
               v  v  v  v
    +-------------------------------------+
    | .github/                             |
    |   copilot-instructions.md            |  <- workspace-wide
    |   agents/                            |
    |     repo-root.agent.md               |  <- orchestrator
    |     backend.agent.md                 |  <- sub-agent
    |     frontend.agent.md                |  <- sub-agent
    |   skills/                            |
    |     <domain>/SKILL.md                |
    |   copilot/                           |
    |     handoffs.json                    |  <- agent graph
    |   hooks/*.yaml                       |
    | skills-registry.jsonl                |
    +-------------------------------------+
```

### Implementation Phases

---

#### Phase 1: D1 — Shared Analyzer Core + Unified Types

**Goal:** Extract duplicated logic from `analyzer/index.ts` (677 LOC) and `analyzer/remote.ts` (612 LOC) into a shared core with unified types.

**New File Structure:**

```
src/analyzer/
  types.ts          <- unified SkillDefinition, AgentDefinition, AnalysisResult
  core.ts           <- shared analysis logic (~200 lines extracted)
  local.ts          <- local-path analyzer (extends core)
  remote.ts         <- GitHub API analyzer (extends core)
  index.ts          <- barrel export + factory function
```

**Tasks:**

- [ ] Create `src/analyzer/types.ts` — unify `SkillDefinition` / `RemoteSkill`, `AgentDefinition` / `RemoteAgent`, `AnalysisResult` into single types
- [ ] Create `src/analyzer/core.ts` — extract `flattenAgents()`, `normalizeTools()`, `detectDomainBoundaries()`, CopilotClient session setup, prompt templates, and result mapping
- [ ] Refactor `src/analyzer/local.ts` — local file reading + calls to core
- [ ] Refactor `src/analyzer/remote.ts` — GitHub API file fetching + calls to core
- [ ] Update `src/analyzer/index.ts` — barrel export with `createAnalyzer(mode: 'local' | 'remote')` factory
- [ ] Update `src/commands/assimilate.ts` — use factory instead of direct imports
- [ ] Add `repoName` to unified `AnalysisResult` type (already partially done per commit `bf9baa1`)

**Acceptance Criteria:**

- [ ] Zero duplicated analysis logic between local and remote analyzers
- [ ] Single `SkillDefinition` type used everywhere
- [ ] Single `AgentDefinition` type used everywhere
- [ ] Both analyzers produce identical `AnalysisResult` shape
- [ ] All files under 500 LOC
- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` succeeds

**Existing Bugs to Fix in D1:**

- **Registry path mismatch** (`src/registry/index.ts:55`): References `agent.yaml` path but Generator creates `.agent.md` files. Fix the path construction to match actual output.
- **PERMISSIVE_LICENSES inconsistency**: `src/commands/assimilate.ts:22-25` has a hardcoded subset that differs from the canonical list in `src/utils/license.ts:19-46`. Remove the duplicate and use the license utility exclusively.

**Effort:** 3-4 days

---

#### Phase 2: D2 — Zod Validation Schemas

**Goal:** Validate all LLM output from `@github/copilot-sdk` CopilotClient sessions using Zod (already a dependency, never used).

**New File:**

```
src/analyzer/schemas.ts   <- Zod schemas for LLM output validation
```

**Tasks:**

- [ ] Define `SkillOutputSchema` — validates LLM-generated skill definitions (name, description, instructions, patterns, anti-patterns)
- [ ] Define `AgentOutputSchema` — validates LLM-generated agent definitions (name, description, tools array, domain boundaries)
- [ ] Define `DomainBoundarySchema` — validates directory-to-domain mapping output
- [ ] Define `HandoffSchema` — validates agent delegation relationships
- [ ] Integrate validation into `analyzer/core.ts` after each CopilotClient session turn
- [ ] Add structured error recovery: on validation failure, retry with corrective prompt including Zod error messages
- [ ] Add `--strict` flag to CLI that fails on validation warnings (default: log warnings, continue)

**Acceptance Criteria:**

- [ ] Every LLM output path has Zod validation
- [ ] Validation errors include the Zod path (e.g., `skills[0].name: Required`)
- [ ] Failed validation triggers ONE retry with error context injected into prompt
- [ ] After retry failure, falls back to heuristic analysis with warning
- [ ] `zod` import is no longer unused (resolves TD-03)
- [ ] Unit tests cover validation happy path and error recovery

**Effort:** 2-3 days

---

#### Phase 3a: D3a — Async GitHubClient

**Goal:** Replace all `execSync` calls in `src/github/index.ts` with async alternatives using `execFile` (not `exec`).

**Tasks:**

- [ ] Replace `execSync` with `util.promisify(child_process.execFile)` for `gh` CLI calls — `execFile` avoids shell injection by not spawning a shell
- [ ] Fix `encodeURIComponent` on file paths (line 116) — GitHub API expects raw paths with slashes, not encoded ones
- [ ] Add proper error handling with typed errors for: auth failure, rate limiting, repo not found, network errors
- [ ] Add retry logic with exponential backoff for rate-limited responses (HTTP 429)
- [ ] Update all callers to properly `await` results

**Acceptance Criteria:**

- [ ] Zero `execSync` calls in `src/github/index.ts`
- [ ] Uses `execFile` (not `exec`) to prevent shell injection
- [ ] `encodeURIComponent` bug fixed — paths like `src/routes/users.ts` work correctly
- [ ] Rate limiting returns clear error message with retry-after time
- [ ] Auth failures surface actionable message ("Run `gh auth login` first")
- [ ] Unit tests for error paths

**Effort:** 1-2 days

---

#### Phase 3b: D3b — Unit Test Suite

**Goal:** Establish test coverage for the foundational modules, providing a safety net for the multi-agent generator work.

**New Files:**

```
tests/
  scanner.test.ts
  registry.test.ts
  license.test.ts
  generator.test.ts
  analyzer/
    core.test.ts
    schemas.test.ts
  github/
    client.test.ts
  utils/
    git.test.ts
```

**Tasks:**

- [ ] `scanner.test.ts` — test file enumeration, language detection, framework detection, ignore patterns
- [ ] `registry.test.ts` — test JSONL read/write, search scoring, type filtering
- [ ] `license.test.ts` — test all license families detection, proprietary detection, package.json fallback, pyproject.toml fallback
- [ ] `generator.test.ts` — test SKILL.md frontmatter generation, agent.md generation, YAML escaping (per commit `defb1d7`)
- [ ] `analyzer/core.test.ts` — test `flattenAgents()`, `normalizeTools()`, `detectDomainBoundaries()` with mocked CopilotClient
- [ ] `analyzer/schemas.test.ts` — test Zod schema validation and error messages
- [ ] `github/client.test.ts` — test async methods with mocked `gh` CLI responses
- [ ] `utils/git.test.ts` — test URL parsing, normalization, repo name extraction

**Testing Approach:** London School TDD (mock-first). Mock `@github/copilot-sdk` CopilotClient, `fs` operations, and `gh` CLI. Test behavior, not implementation.

**Acceptance Criteria:**

- [ ] `npm test` passes with 0 failures
- [ ] Coverage targets: Scanner >= 80%, Registry >= 90%, License >= 85%, Generator >= 75%
- [ ] All tests use vitest with proper TypeScript configuration
- [ ] CopilotClient is mocked — tests don't require network or API keys
- [ ] Tests run in < 10 seconds total

**Effort:** 3-4 days

---

#### Phase 4: D4 — Multi-Agent Constellation Generator

**Goal:** Refactor `src/generator/index.ts` to produce multiple `.agent.md` files with `runSubagent` tool declarations and a `handoffs.json` delegation graph.

**Modified/New Files:**

```
src/generator/
  index.ts               <- refactored: orchestrates multi-agent output
  agent-writer.ts        <- writes individual .agent.md files
  handoff-writer.ts      <- writes .github/copilot/handoffs.json
  templates.ts           <- agent.md templates with frontmatter
```

**Tasks:**

- [ ] Analyze `detectDomainBoundaries()` output to determine agent topology (1 root + N sub-agents)
- [ ] Generate `repo-root.agent.md` as orchestrator with `runSubagent` in tools array
- [ ] Generate domain-specific `.agent.md` files (e.g., `backend.agent.md`, `frontend.agent.md`)
- [ ] Each sub-agent's body includes delegation instructions ("When asked about X, I handle it. For Y, suggest @other-agent")
- [ ] Generate `.github/copilot/handoffs.json` codifying the delegation graph
- [ ] Update `skills-registry.jsonl` to include all generated agents with correct paths
- [ ] Preserve backward compatibility: `--single-agent` flag generates v0.3 single-file output
- [ ] Update agent.md frontmatter to use richer VS Code fields: `tools`, `description`, optionally `model`

**handoffs.json Example:**

```json
{
  "handoffs": [
    { "from": "repo-root", "to": "backend", "triggers": ["api", "server", "database"] },
    { "from": "repo-root", "to": "frontend", "triggers": ["ui", "component", "styling"] }
  ]
}
```

**Agent Naming Convention:**

- Filename-based: `backend.agent.md` -> `@backend` in VS Code
- Root agent always named after repo or `repo-root`
- Sub-agents named by domain boundary (directory name or detected framework purpose)

**Acceptance Criteria:**

- [ ] Running `agentsmith assimilate` on a full-stack repo produces >= 2 `.agent.md` files
- [ ] Root agent has `runSubagent` in its `tools:` frontmatter array
- [ ] Root agent body contains handoff instructions referencing sub-agents by name
- [ ] `handoffs.json` is valid JSON with correct from/to/triggers structure
- [ ] `skills-registry.jsonl` includes entries for all agents with correct `.agent.md` paths
- [ ] `--single-agent` flag produces identical output to v0.3
- [ ] Generated agents pass `agentsmith validate`

**Effort:** 4-5 days

---

#### Phase 5: D5 — Copilot Instructions Generation

**Goal:** Generate `.github/copilot-instructions.md` (workspace-wide) that teaches Copilot this repo's conventions for all interactions.

**Modified/New Files:**

```
src/generator/
  instructions-writer.ts  <- generates copilot-instructions.md
```

**Tasks:**

- [ ] Generate `.github/copilot-instructions.md` from analysis results:
  - Language and framework identification
  - Project structure conventions (file naming, directory organization)
  - Coding patterns (error handling approach, module system, import conventions)
  - Testing conventions (framework, file naming, describe/it structure)
  - Build and dependency management info
- [ ] Source conventions from: Scanner language data, Analyzer pattern extraction, existing README/docs
- [ ] Keep instructions concise (< 200 lines) — VS Code loads this into every Copilot interaction
- [ ] Add `--no-instructions` flag to skip generation
- [ ] Idempotent: re-running preserves user-added sections (detect `<!-- agentsmith:managed -->` markers)

**Generated Example:**

```markdown
<!-- agentsmith:managed -->
# Copilot Instructions

This is a TypeScript monorepo using Express.js for the backend and React for the frontend.

## Coding Conventions
- Use `AppError` class for all error handling (see `src/errors/AppError.ts`)
- All API routes follow RESTful naming: `GET /api/<resource>`, `POST /api/<resource>`
- Use functional React components with hooks only -- no class components

## Project Structure
- `src/routes/` -- Express route handlers
- `src/models/` -- Database models (Prisma)
- `src/frontend/` -- React application
- `tests/` -- Vitest test files, mirror src/ structure

## Testing
- Use vitest with `describe`/`it` blocks
- Mock external dependencies, never hit real APIs in tests
<!-- /agentsmith:managed -->
```

**Acceptance Criteria:**

- [ ] `agentsmith assimilate` generates `.github/copilot-instructions.md`
- [ ] Instructions are factual (derived from analysis, not hallucinated)
- [ ] Re-running with existing file preserves content outside managed markers
- [ ] `--no-instructions` flag skips generation
- [ ] Instructions reference actual file paths from the analyzed repo
- [ ] File stays under 200 lines

**Effort:** 2-3 days

---

## Alternative Approaches Considered

| Approach | Why Rejected |
|----------|-------------|
| **Abstract base class for Analyzer** | TypeScript favors composition over inheritance. Shared module + factory is simpler and more testable |
| **Runtime validation (not Zod)** | Zod is already a dependency. Adding another validation library adds complexity |
| **Single agent with skill injection** | VS Code runtime is designed for multi-agent handoffs. Single agent hits context window limits on large repos |
| **JSON Schema for LLM validation** | Zod provides TypeScript type inference + runtime validation in one step. JSON Schema requires separate types |
| **per-directory `.copilot-instructions.md`** | Deferred to Phase 2 (v0.5). Workspace-wide instructions provide the highest impact for Phase 1 |

## System-Wide Impact

### Interaction Graph

```
CLI (main.ts)
  -> assimilateCommand (commands/assimilate.ts)
    -> resolveInput (utils/git.ts) -- may clone repo
    -> detectLicense (utils/license.ts) -- gating
    -> createAnalyzer() (analyzer/index.ts) -- D1 CHANGES
      -> Analyzer.core (analyzer/core.ts) -- NEW
        -> CopilotClient session (SDK)
        -> Zod validation (analyzer/schemas.ts) -- D2 NEW
      -> LocalAnalyzer | RemoteAnalyzer -- D1 REFACTORED
        -> GitHubClient (github/index.ts) -- D3a ASYNC
    -> MultiAgentGenerator (generator/index.ts) -- D4 REFACTORED
      -> agent-writer.ts -- D4 NEW
      -> handoff-writer.ts -- D4 NEW
      -> instructions-writer.ts -- D5 NEW
    -> Registry.update (registry/index.ts)
    -> HookRunner (hooks/index.ts)
```

### Error and Failure Propagation

| Error Source | Current Behavior | Target Behavior |
|-------------|-----------------|-----------------|
| CopilotClient session failure | Silent fallback to heuristics | Log warning, fall back with `[HEURISTIC]` prefix in output |
| Zod validation failure | N/A (no validation) | Retry once with error context, then fallback |
| GitHub API rate limit | Unhandled crash | Typed `RateLimitError` with retry-after, exponential backoff |
| GitHub auth failure | Generic error | `AuthenticationError` with "Run `gh auth login`" message |
| Invalid handoffs.json | N/A | Zod validates before write, skip with warning if invalid |
| Generator write failure | Unhandled | Typed `GeneratorError`, cleanup partial output |

### State Lifecycle Risks

- **Partial generation**: If generator crashes mid-write, some `.agent.md` files may exist without `handoffs.json`. Mitigation: write to temp directory, atomic move on success.
- **Registry inconsistency**: If generator succeeds but registry.update() fails, `skills-registry.jsonl` is stale. Mitigation: registry update is last step, failure is a warning not an error.
- **Temp clone cleanup**: Already handled by `CloneResult.cleanup()` in `utils/git.ts`.

### API Surface Parity

| Interface | Needs Update | Reason |
|-----------|-------------|--------|
| `assimilateCommand()` | Yes | Use analyzer factory, pass to multi-agent generator |
| `searchCommand()` | Minor | Registry entries now include agent type metadata |
| `validateCommand()` | Yes | Must validate multiple `.agent.md` files + `handoffs.json` |
| `Registry.search()` | Minor | Handle `type: "agent"` entries with `.agent.md` paths |
| `HookRunner` | No change | Hooks run post-generate regardless of output shape |

### Integration Test Scenarios

1. **Full local assimilation**: `agentsmith assimilate ./fixtures/fullstack-app` produces root agent + 2 sub-agents + handoffs.json + copilot-instructions.md + skills + registry entries
2. **Remote assimilation**: `agentsmith assimilate https://github.com/example/repo` uses async GitHubClient, produces same constellation output
3. **Single-agent fallback**: `agentsmith assimilate ./fixtures/simple-lib --single-agent` produces single `.agent.md` (v0.3 compat)
4. **Validation round-trip**: Generate then Validate cycle passes with zero errors
5. **Idempotent instructions**: Generate then add user content then re-generate preserves user content outside markers
6. **License gating**: Proprietary repo is rejected before analysis begins
7. **SDK unavailable**: CopilotClient fails then heuristic fallback produces valid constellation
8. **LLM validation failure**: Zod rejects malformed output then retry then fallback then still produces valid output

## Acceptance Criteria

### Functional Requirements

- [ ] `agentsmith assimilate` generates multi-agent constellation (root + sub-agents)
- [ ] `agentsmith assimilate` generates `.github/copilot-instructions.md`
- [ ] `agentsmith assimilate` generates `.github/copilot/handoffs.json`
- [ ] `agentsmith validate` validates all new output formats
- [ ] `agentsmith search` finds agents by domain keywords
- [ ] `--single-agent` flag preserves v0.3 backward compatibility
- [ ] `--no-instructions` flag skips copilot-instructions.md generation
- [ ] `--strict` flag fails on Zod validation warnings

### Non-Functional Requirements

- [ ] Zero `execSync` calls in async code paths
- [ ] All source files under 500 LOC
- [ ] Zero duplicated analysis logic
- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` succeeds
- [ ] `npm test` passes with >= 80% coverage on core modules

### Quality Gates

- [ ] All 3 existing bugs fixed (registry path, license inconsistency, encodeURIComponent)
- [ ] Vitest test suite with mocked CopilotClient
- [ ] No new `any` types introduced
- [ ] HookRunner command injection risk documented (fix deferred to v0.5, TD-09)

## Success Metrics

| Metric | Target |
|--------|--------|
| Generated agents per full-stack repo | >= 3 (root + 2 domains) |
| Validation pass rate on generated output | 100% |
| Test suite execution time | < 10 seconds |
| Test coverage (core modules) | >= 80% |
| Build time | < 5 seconds |
| Source files over 500 LOC | 0 |
| Duplicated analyzer logic | 0 lines |

## Dependencies and Prerequisites

| Dependency | Status | Risk |
|-----------|--------|------|
| `@github/copilot-sdk` ^0.1.0 | Installed | SDK is pre-release, API may change |
| `zod` ^3.22.0 | Installed, unused | No risk -- just needs schemas written |
| `vitest` ^1.2.0 | Installed, no tests | No risk -- just needs test files |
| VS Code `.agent.md` format | Stable | Low -- format is documented and tested |
| `runSubagent` tool support | Available | Medium -- depends on VS Code Copilot version |
| `handoffs.json` format | Custom | Low -- our own convention, not VS Code mandated |

## Risk Analysis and Mitigation

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|------------|
| `@github/copilot-sdk` breaking changes | High | Medium | Pin version, isolate SDK calls behind adapter interface in `analyzer/core.ts` |
| `runSubagent` not available in user's VS Code | Medium | Medium | Graceful degradation: agents still work independently, handoff instructions are advice not requirements |
| Refactoring breaks existing behavior | High | Medium | D3b (tests) runs parallel to D1 -- tests validate before and after refactor |
| LLM generates poor domain boundaries | Medium | High | Zod validation catches malformed output, heuristic fallback produces safe defaults, `--single-agent` escape hatch |
| HookRunner command injection (TD-09) | Medium | Low | Deferred to v0.5. Document risk. Do not pass user input to hooks in v0.4. |

## Security Considerations

1. **HookRunner injection (TD-09)**: Not fixing in v0.4. Risk is medium-low because hooks are defined in YAML files committed to the repo, not from user input at runtime. Document the risk, fix in v0.5 with allowlist validation.

2. **GitHubClient async refactor**: Use `execFile` (not `exec`) to prevent shell injection. Never pass tokens through our code. Verify tokens don't appear in error messages or logs.

3. **Temp directory cleanup**: `cloneRepo()` already handles cleanup. Verify atomic temp-to-final directory move in generator doesn't leak partial output.

## Documentation Plan

- [ ] Update `docs/PRD.md` with v0.4 deliverables and completion status
- [ ] Update `README.md` CLI usage section with new flags (`--single-agent`, `--no-instructions`, `--strict`)
- [ ] Add `docs/ARCHITECTURE.md` documenting the new analyzer core + generator pipeline
- [ ] Add inline JSDoc to all new public interfaces in `types.ts` and `schemas.ts`

## Deliverable Dependency Graph

```
D1 (Shared Analyzer Core)
  |---> D2 (Zod Validation)
  |---> D3b (Unit Tests)
  |---> D4 (Multi-Agent Generator) <--- D2, D3a
  |                |
  |                +---> D5 (Copilot Instructions)
  |
D3a (Async GitHubClient) --- runs parallel with D1
D3b (Unit Tests) --- validates D1, D2, D3a, D4
```

**Recommended execution order:** D1 -> D3a (parallel with D2) -> D3b (parallel with D2) -> D4 -> D5

## Sources and References

### Origin

- **Strategy document:** [docs/STRATEGY-v2.md](../STRATEGY-v2.md) — Copilot-Native Roadmap. Key decisions carried forward:
  - Multi-agent constellation with `runSubagent` handoffs (Feature #1)
  - Deep VS Code integration via `copilot-instructions.md` (Feature #2)
  - Zod validation for LLM output (TD-03)
  - Shared analyzer core extraction (TD-01, TD-02)

### Internal References

- `src/analyzer/index.ts` — current local analyzer (677 LOC, to be split)
- `src/analyzer/remote.ts` — current remote analyzer (612 LOC, to be split)
- `src/generator/index.ts:302` — current single-agent generator (to be refactored)
- `src/github/index.ts:116` — `encodeURIComponent` bug location
- `src/registry/index.ts:55` — registry path mismatch bug
- `src/commands/assimilate.ts:22-25` — duplicated license list
- Commit `bf9baa1` — `repoName` added to `AnalysisResult`
- Commit `defb1d7` — YAML escaping improvements in generator

### External References

- VS Code Custom Agents documentation
- `@github/copilot-sdk` npm package
- Zod documentation (zod.dev)
- CLI-Anything (reference architecture for CLI generation pipeline adapted for Copilot-native output)

### Research Findings

- VS Code agent runtime supports fields not currently generated: `model`, `promptParts`, `displayName`, template variables (`{{cwd}}`, `{{selection}}`), MCP server declarations per-agent
- CopilotClient session config has `customAgents` and `skillDirectories` fields for loading generated assets programmatically
- `defineTool` enables model-driven file exploration during analysis sessions
- `assistant.reasoning` events can capture chain-of-thought for convention extraction

### SpecFlow Analysis Highlights

- 13 specification gaps identified across D1-D5
- 3 existing bugs to fix (registry path, license list, encodeURIComponent)
- Dependency graph: D1 must complete before D2/D4; D3a/D3b can run in parallel
- 8 integration test scenarios documented
- Security gap: HookRunner injection deferred to v0.5 with documentation requirement
