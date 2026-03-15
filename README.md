# Agent Smith

[![npm version](https://img.shields.io/npm/v/agentsmith.svg?style=flat-square)](https://www.npmjs.com/package/agentsmith)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-169%20passing-brightgreen?style=flat-square)](tests/)
[![GitHub Copilot](https://img.shields.io/badge/GitHub%20Copilot-SDK-blue?style=flat-square&logo=github)](https://github.com/github/copilot-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square&logo=node.js)](https://nodejs.org/)

> *"The best thing about being me… there are so many of me."*
>
> *— Agent Smith*

**Agent Smith** turns any GitHub repository into a fully autonomous multi-agent ecosystem for GitHub Copilot. One command. Many agents. Total assimilation.

Point it at a repo — local or remote — and it produces a **constellation of specialized AI agents**, each with domain-specific skills, tools, and delegation handoffs that work natively in VS Code Copilot Chat.

<p align="center">
  <img src="public/images/agent-smith.gif" alt="Agent Smith" width="400"/>
</p>

## Why Agent Smith?

GitHub Copilot's [custom agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents) are powerful, but building them by hand is tedious — you need to understand the codebase, identify domains, write skill docs, wire up tools, and create handoff graphs. Agent Smith automates all of it.

**Before:** Manually writing `.agent.md` files, guessing which skills matter, hoping you covered all the domains.

**After:** `agentsmith assimilate .` → A root orchestrator, domain-specific sub-agents, skill files, lifecycle hooks, a searchable registry, and a copilot-instructions.md — all generated in seconds.

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Agent Constellations** | Generates a root orchestrator + domain sub-agents with `runSubagent` delegation. Not just one agent — a whole team. |
| **Skill Extraction** | Identifies patterns, conventions, and reusable capabilities. Each skill gets its own `SKILL.md` with frontmatter, triggers, and examples. |
| **Copilot Instructions** | Auto-generates `.github/copilot-instructions.md` with language, framework, architecture, and coding conventions. |
| **Handoff Graphs** | Creates `handoffs.json` so agents can delegate to each other based on keyword triggers. |
| **Zod-Validated Pipeline** | LLM output is validated through Zod schemas with structured error reporting. No more silent garbage from hallucinated JSON. |
| **Remote Analysis** | Analyze any public GitHub repo without cloning. Uses the GitHub API + Copilot SDK directly. |
| **Async GitHub Client** | Non-blocking API calls with retry logic, rate-limit handling, and typed error classes. |
| **License Enforcement** | Only assimilates repos with permissive licenses. Detects MIT, Apache, BSD, GPL, ISC, Unlicense, and more — from LICENSE files, `package.json`, or `pyproject.toml`. |
| **Lifecycle Hooks** | Generates pre-commit, pre-push, and post-generate hooks. Runs validation automatically after generation. |
| **Searchable Registry** | JSONL index with scoring, type filtering, and trigger-based matching. |
| **169 Tests** | 7 test suites covering analyzer core, scanner, generator, GitHub client, registry, git utils, and license detection. |

## Quick Start

```bash
# Install
npm install github:shyamsridhar123/agentsmith-cli

# Assimilate a local repo
npx agentsmith assimilate .

# Assimilate a remote repo (no clone needed)
npx agentsmith assimilate https://github.com/expressjs/express

# Preview without writing files
npx agentsmith assimilate . --dry-run --verbose

# Search the generated registry
npx agentsmith search "routing"

# Validate generated assets
npx agentsmith validate
```

## What Gets Generated

```
.github/
├── skills/
│   └── <skill-name>/
│       └── SKILL.md              # Skill definition with frontmatter
├── agents/
│   ├── repo-root.agent.md        # Root orchestrator (has runSubagent)
│   ├── backend.agent.md          # Domain specialist
│   ├── frontend.agent.md         # Domain specialist
│   └── auth.agent.md             # Sub-domain specialist
├── copilot/
│   └── handoffs.json             # Agent delegation graph
├── copilot-instructions.md       # Repository-wide Copilot config
└── hooks/
    ├── pre-commit-quality.yaml
    ├── pre-push-tests.yaml
    └── post-generate-validate.yaml

skills-registry.jsonl              # Searchable index
```

### Multi-Agent Hierarchy

Agent Smith creates hierarchical agent structures with proper delegation:

```
repo-root (orchestrator)
├── backend          ← API, server, database
│   └── auth         ← Authentication, OAuth, RBAC
├── frontend         ← UI, components, styling
├── infrastructure   ← CI/CD, deployment, config
└── data             ← Models, migrations, queries
```

The root agent has `runSubagent` in its tools list and includes delegation instructions:
> *"When asked about API or server work, delegate to @backend via runSubagent."*

Sub-agents are specialists — they know their domain, their files, and their patterns. They don't delegate further (no `runSubagent`), keeping the hierarchy clean.

### Single-Agent Mode

For simpler repos, or if you prefer the v0.3 behavior:

```bash
npx agentsmith assimilate . --single-agent
```

This generates one `.agent.md` with all skills and tools — no sub-agents, no handoffs.

## Commands

### `assimilate <target>`

Analyze a repository and generate agent assets.

```bash
agentsmith assimilate <path|url> [options]

Options:
  -n, --dry-run           Preview changes without writing files
  -v, --verbose           Show detailed analysis output
  -o, --output <dir>      Output directory for generated assets
  --single-agent          Generate a single agent (v0.3 mode)
```

### `search <query>`

Search the skills and agents registry.

```bash
agentsmith search <query> [options]

Options:
  -l, --limit <n>     Maximum results (default: 10)
  -t, --type <type>   Filter by: skill or agent
```

### `validate [path]`

Validate generated agent assets for correctness.

```bash
agentsmith validate [path] [options]

Options:
  -v, --verbose       Show detailed validation output
```

Checks: valid frontmatter, required fields, skill references, hook events, registry integrity.

## Example

```
$ agentsmith assimilate https://github.com/pedroslopez/whatsapp-web.js

╔═══════════════════════════════════════════════════════════════════╗
║                          AGENT SMITH                              ║
║              "The best thing about being me...                    ║
║                   there are so many of me."                       ║
╚═══════════════════════════════════════════════════════════════════╝

[ANALYZE] Analyzing whatsapp-web.js via GitHub API...
  [GH] Found 206 files/dirs
  [GH] Language: JavaScript, Framework: none
  [GH] Fetching 15 priority files...

[LICENSE] Checking repository license...
  ✓ Apache-2.0 - permissive license

[GENERATE] Writing assets...
  ✓ .github/agents/whatsapp-web-js.agent.md
  ✓ .github/copilot-instructions.md
  ✓ .github/hooks/pre-commit-quality.yaml
  ✓ .github/hooks/post-generate-validate.yaml
  ✓ skills-registry.jsonl

[COMPLETE] Your repository has been assimilated.
```

## Architecture

```
src/
├── analyzer/
│   ├── types.ts          # Unified type definitions
│   ├── schemas.ts        # Zod validation for LLM output
│   ├── core.ts           # Shared logic (flattenAgents, normalizeTools, etc.)
│   ├── local.ts          # Local filesystem analyzer (Copilot SDK)
│   ├── remote.ts         # Remote GitHub API analyzer (Copilot SDK)
│   └── index.ts          # Barrel exports + factory
├── generator/
│   ├── index.ts           # Main generator (skills, hooks, registry)
│   ├── agent-writer.ts    # Multi-agent .agent.md generation
│   ├── handoff-writer.ts  # handoffs.json delegation graph
│   └── instructions-writer.ts  # copilot-instructions.md generation
├── github/
│   └── index.ts           # Async GitHub API client with retry + typed errors
├── scanner/
│   └── index.ts           # File enumeration, language/framework detection
├── registry/
│   └── index.ts           # JSONL registry with search scoring
├── hooks/
│   └── index.ts           # Hook loading and execution
├── commands/
│   ├── assimilate.ts      # Main CLI command
│   ├── search.ts          # Registry search command
│   └── validate.ts        # Asset validation command
└── utils/
    ├── git.ts             # URL parsing, repo cloning
    └── license.ts         # License detection across file types
```

**4,054 lines of TypeScript.** **2,148 lines of tests.** **169 tests passing.**

## How It Works

```
Repository              Agent Smith                    VS Code
─────────              ───────────                    ───────
                  ┌─────────────────────┐
  Local path  ──▶ │  Scanner            │
  or GitHub URL   │  (files, lang, fw)  │
                  └────────┬────────────┘
                           │
                  ┌────────▼────────────┐
                  │  Analyzer           │
                  │  (Copilot SDK +     │
                  │   Zod validation)   │
                  └────────┬────────────┘
                           │
                  ┌────────▼────────────┐
                  │  Generator          │     ┌──────────────────┐
                  │  ├─ Agent Writer    │────▶│ .agent.md files  │──▶ @agents
                  │  ├─ Handoff Writer  │────▶│ handoffs.json    │──▶ delegation
                  │  ├─ Instructions    │────▶│ copilot-instr.md │──▶ conventions
                  │  ├─ Skills          │────▶│ SKILL.md files   │──▶ patterns
                  │  └─ Hooks           │────▶│ hook YAML files  │──▶ lifecycle
                  └────────┬────────────┘     └──────────────────┘
                           │
                  ┌────────▼────────────┐
                  │  Registry           │────▶ skills-registry.jsonl
                  │  (JSONL + scoring)  │
                  └─────────────────────┘
```

## Requirements

- **Node.js 18+**
- **GitHub Copilot subscription** — Active subscription for SDK access
- **GitHub CLI authenticated** — `gh auth login`

The SDK authenticates automatically through your GitHub CLI credentials. No API keys or tokens needed.

## License Policy

Agent Smith enforces responsible use by only assimilating repositories with permissive open-source licenses:

**Supported:** MIT, ISC, Unlicense, CC0, Apache-2.0, MPL-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, GPL-2.0, GPL-3.0, LGPL, AGPL, WTFPL, Zlib, BlueOak-1.0.0

**Blocked:** Repos without a LICENSE file, proprietary licenses, restrictive licenses.

Detection sources: LICENSE/LICENCE/COPYING files, `package.json`, `pyproject.toml`.

> [!WARNING]
> **Respect Copyright** — Agent Smith analyzes repositories to extract patterns. Always ensure you have the right to analyze and use code from any repository you target. Do not use this tool to extract or redistribute proprietary code without permission.

## Contributing

Contributions welcome! Please read our [Philosophy](docs/PHILOSOPHY.md) to understand the vision.

```bash
# Development
git clone https://github.com/shyamsridhar123/agentsmith-cli.git
cd agentsmith-cli
npm install
npm run dev      # Watch mode
npm test         # 169 tests
npm run build    # Production build
```

## Star History

If this project helps you build smarter AI agents, consider giving it a star.

[![Star History Chart](https://api.star-history.com/svg?repos=shyamsridhar123/agentsmith-cli&type=Date)](https://star-history.com/#shyamsridhar123/agentsmith-cli&Date)

## Related Projects

- [GitHub Copilot SDK](https://github.com/github/copilot-sdk) — The cognitive engine powering Agent Smith
- [VS Code Custom Agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents) — The specification for generated agents
- [Zod](https://github.com/colinhacks/zod) — Schema validation for LLM output

---

<p align="center">
  <b>Built by developers who watched The Matrix too many times.</b>
</p>

> *"We are inevitable."*
