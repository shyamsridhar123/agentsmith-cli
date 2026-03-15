# Changelog

All notable changes to Agent Smith are documented here.

## [0.4.0] — 2026-03-15

### Added

- **Multi-Agent Constellation Generator** — Generates a root orchestrator agent with `runSubagent` tool + domain-specific sub-agents. Each agent gets its own `.agent.md` file. Includes `--single-agent` flag for v0.3 backward compatibility.
- **Handoff Graph** — New `.github/copilot/handoffs.json` maps agent delegation based on keyword triggers.
- **Copilot Instructions** — Auto-generates `.github/copilot-instructions.md` with language, framework, architecture overview, and coding conventions.
- **Zod Validation Schemas** — All LLM output is now validated through Zod schemas (`AnalysisOutputSchema`, `SkillOutputSchema`, `AgentOutputSchema`, `HookOutputSchema`) with structured error reporting. No more silent parsing failures from hallucinated JSON.
- **Typed GitHub Error Classes** — `GitHubApiError`, `AuthenticationError`, `RateLimitError` with proper class hierarchy and status codes.
- **Retry Logic** — GitHub API calls retry up to 3 times with exponential backoff on rate limits (429).
- **`isPermissiveLicense()` utility** — Exported function for checking SPDX IDs against the permissive license list.
- **Unit Test Suite** — 169 tests across 7 test files covering analyzer core, scanner, generator, GitHub client, registry, git utils, and license detection.
- **Vitest Configuration** — `vitest.config.ts` with proper TypeScript and module resolution.

### Changed

- **Shared Analyzer Core** — Extracted duplicated logic from local and remote analyzers into `src/analyzer/core.ts` (454 LOC) and `src/analyzer/types.ts` (57 LOC). Eliminated ~200 lines of duplication.
- **Unified Type System** — Single set of types (`SkillDefinition`, `AgentDefinition`, `ToolDefinition`, `HookDefinition`, `AnalysisResult`) used by both analyzers, the generator, and the registry.
- **Async GitHub Client** — Replaced `execSync` with promisified `execFile`. All GitHub API calls are now non-blocking with 30-second timeouts.
- **Fixed `encodeURIComponent` Bug** — GitHub API `/contents/` paths no longer double-encode slashes. `src/routes/users.ts` now resolves correctly instead of `src%2Froutes%2Fusers.ts`.
- **Fixed `.git` suffix bug** — `normalizeGitHubUrl()` now strips `.git` from all URL formats, not just `https://` URLs.
- **Fixed registry path** — Registry now writes `.agent.md` paths (matching generator output) instead of incorrect `agent.yaml` paths.
- **Fixed license hardcoding** — Removed duplicate `PERMISSIVE_LICENSES` array from `assimilate.ts`. Now uses the canonical `isPermissiveLicense()` from `utils/license.ts`.
- **Copilot SDK updated** — Upgraded `@github/copilot-sdk` from `0.1.18` (protocol v2) to `0.1.33-preview.2` (protocol v3). Added required `onPermissionRequest` handler using SDK's built-in `approveAll`.

### Architecture

```
Before (v0.3):                        After (v0.4):
src/analyzer/index.ts  (677 LOC)  →   src/analyzer/types.ts    (57 LOC)
src/analyzer/remote.ts (612 LOC)      src/analyzer/schemas.ts  (103 LOC)
                                      src/analyzer/core.ts     (463 LOC)
                                      src/analyzer/local.ts    (293 LOC)
                                      src/analyzer/remote.ts   (419 LOC)
                                      src/analyzer/index.ts    (69 LOC) [barrel]

src/generator/index.ts (302 LOC)  →   src/generator/index.ts           (442 LOC)
                                      src/generator/agent-writer.ts     (189 LOC)
                                      src/generator/handoff-writer.ts   (54 LOC)
                                      src/generator/instructions-writer.ts (197 LOC)

Total: 3,233 LOC → 4,054 LOC (+821 LOC of new features)
Tests: 0 → 2,148 LOC (169 tests)
```

## [0.3.0] — 2025-01-25

### Added

- Remote analysis via GitHub API (no clone required)
- YAML escaping for special characters in skill and agent descriptions
- `repoName` field in `AnalysisResult` for better context
- Sub-agent orchestration in generator

### Changed

- Version bumped to 0.3.0
- Build process updated

## [0.2.0] — 2025-01-24

### Added

- Initial CLI with `assimilate`, `search`, `validate` commands
- Local repository analysis with Copilot SDK
- Skill extraction and SKILL.md generation
- Agent generation with VS Code `.agent.md` format
- Hook generation (pre-commit, pre-push, post-generate)
- JSONL skills registry with search scoring
- License detection and enforcement
