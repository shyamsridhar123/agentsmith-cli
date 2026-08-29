# Agent Smith

[![npm version](https://img.shields.io/npm/v/agentsmith-cli.svg?style=flat-square)](https://www.npmjs.com/package/agentsmith-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![GitHub Copilot](https://img.shields.io/badge/GitHub%20Copilot-SDK-blue?style=flat-square&logo=github)](https://github.com/github/copilot-sdk)
[![Node.js](https://img.shields.io/badge/Node.js-20.19%2B%20%7C%2022.12%2B-green?style=flat-square&logo=node.js)](https://nodejs.org/)

> *"The best thing about being me… there are so many of me."*

## Turn a CLI codebase into a Copilot-native engineering team

**Agent Smith reverse-engineers how a CLI is actually built**—its framework,
entrypoints, command registrations, flags, extension points, source conventions,
and command-focused tests—then generates a hierarchy of GitHub Copilot agents
that know how to work inside that CLI.

This is not a generic repository summary.

It turns the executable surface of your project into reusable agent knowledge:

- where commands are registered;
- how options and arguments are named;
- which files define the public interface;
- how new commands should be added;
- which validation and exit-code conventions matter;
- where command behavior is tested;
- which specialist agent should own a change.

One command transforms that knowledge into custom agents, skills, handoffs,
Copilot instructions, hooks, and a searchable registry.

```bash
agentsmith assimilate ./my-cli
```

Local repositories are analyzed from a bounded snapshot of the exact source
content Agent Smith inspected. Public GitHub repositories are pinned to one
commit so the license, tree, and files all describe the same revision.

<p align="center">
  <img src="public/images/agent-smith.gif" alt="Agent Smith" width="400"/>
</p>

## Why Agent Smith is CLI-native

Most agent generators inspect files and produce broad documentation. Agent Smith
goes after the **command surface**.

| Capability | What Agent Smith extracts or generates |
|---|---|
| **Framework detection** | Recognizes Commander, Yargs, oclif, Cobra, Click, Typer, and argparse patterns. |
| **Entrypoint discovery** | Finds the files that bootstrap and register the CLI. |
| **Command extraction** | Maps registered commands back to their source files. |
| **Option extraction** | Captures long flags, short flags, required values, and available descriptions. |
| **Extension points** | Identifies the command and CLI directories where new behavior belongs. |
| **CLI-focused skills** | Generates `cli-structure`, `cli-options`, and `cli-testing` knowledge with source references. |
| **Refinement** | Reports missing command knowledge, missing CLI skills, undocumented option surfaces, and absent command-test coverage. |
| **Freshness** | Regenerates without cache and fingerprints generated skills so stale knowledge is visible. |
| **Predictable regeneration** | Reconciles Agent Smith-owned agents, skills, hooks, and handoffs while preserving user-authored files. |
| **Controlled automation** | Generates lifecycle hooks, but runs only the current generation's hooks after an explicit `--run-hooks`. |
| **Pinned remote analysis** | Reads a GitHub repository's license and source from one immutable commit. |

The result is a Copilot team that can answer practical questions such as:

- Where should this new subcommand be registered?
- Which flags already exist, and what naming style does this CLI use?
- What source files define the command?
- Which tests should change with the help text or failure behavior?
- Should this task go to the root orchestrator, a domain agent, or a CLI specialist?

## What Agent Smith generates

```text
.github/
├── agents/
│   ├── <repo>-root.agent.md          # Root orchestrator
│   ├── backend.agent.md              # Domain specialist
│   ├── infrastructure.agent.md       # Domain specialist
│   └── ...
├── skills/
│   ├── cli-structure/SKILL.md        # Commands, entrypoints, source references
│   ├── cli-options/SKILL.md          # Flags, validation, help conventions
│   ├── cli-testing/SKILL.md          # Command-test and failure-path guidance
│   └── <domain-skill>/SKILL.md
├── copilot/
│   ├── handoffs.json                 # Agent delegation map
│   └── freshness.json                # Generated-knowledge fingerprints
├── copilot-instructions.md           # Repository-wide operating context
└── hooks/
    └── *.yaml                        # Generated lifecycle checks

skills-registry.jsonl                 # Searchable agent and skill index
```

The generated root agent can delegate through `runSubagent`. Domain agents stay
focused on their own files and patterns. CLI skills anchor command work to the
actual entrypoints and registrations found in the codebase.

## Quick start

```bash
# Install from GitHub
npm install github:shyamsridhar123/agentsmith-cli

# Analyze the CLI in the current directory
npx agentsmith assimilate .

# Analyze a public GitHub repository without cloning it
npx agentsmith assimilate https://github.com/owner/cli-repo

# Preview exactly what Agent Smith would generate
npx agentsmith assimilate . --dry-run --verbose

# Explicitly run hooks generated during this assimilation
npx agentsmith assimilate . --run-hooks
```

Git-based installation builds the compiled CLI automatically. The installed
`agentsmith` command runs the packaged JavaScript entrypoint directly.

Then tighten and maintain the generated knowledge:

```bash
# Find gaps in command, option, and CLI-test knowledge
npx agentsmith refine . --write-report

# Regenerate without cached analysis
npx agentsmith refresh .

# Search the generated knowledge layer
npx agentsmith search "command validation"

# Validate generated agents, skills, hooks, and registry entries
npx agentsmith validate .
```

## The CLI workflow

### 1. Assimilate

```bash
agentsmith assimilate <path-or-github-url>
```

Agent Smith scans the repository, detects the language and CLI framework,
extracts command-facing structure, analyzes broader domain boundaries, and
generates the complete Copilot agent system.

Useful options:

```text
-n, --dry-run           Preview without writing files
-v, --verbose           Show detailed analysis
-o, --output <path>     Write generated assets elsewhere
--no-cache              Disable analysis caching
--no-instructions       Skip copilot-instructions.md
--single-agent          Generate one combined agent
--run-hooks             Run post-generation hooks created by this run
--hub <url>             Enable optional AgentHub coordination
--record                Record the generated run to AgentHub
```

Hook execution is opt-in. Without `--run-hooks`, Agent Smith writes the hook
definitions for review but does not execute them.

### 2. Refine

```bash
agentsmith refine . --write-report
```

`refine` audits the generated knowledge against the current CLI. It identifies
missing CLI skills, command extraction gaps, commands without detected options,
and missing command-focused tests.

```bash
agentsmith refine . --json
agentsmith refine . --apply
```

### 3. Refresh

```bash
agentsmith refresh .
```

`refresh` bypasses the analysis cache, regenerates the agent system, and updates
freshness fingerprints. It also removes stale Agent Smith-owned agents, skills,
hooks, and handoffs that are no longer part of the generated plan while leaving
user-owned files alone.

### 4. Search and validate

```bash
agentsmith search "routing"
agentsmith search "flag" --type skill
agentsmith validate --verbose
```

The registry gives generated knowledge a queryable surface instead of leaving it
buried across Markdown files. Validation checks that registry entries and agent
references resolve to the generated asset type they claim to represent.

## Supported CLI ecosystems

Agent Smith recognizes common command registration and option patterns across:

- **TypeScript / JavaScript:** Commander, Yargs, oclif
- **Go:** Cobra
- **Python:** Click, Typer, argparse

It also follows conventional `commands/`, `cmd/`, `cli/`, `main`, and entrypoint
layouts when extracting command files and extension points.

## Analyze unfamiliar repositories with clear boundaries

Agent Smith keeps repository input separate from the operations used to generate
the Copilot system:

- **Bounded local snapshots:** it streams repository fingerprints and retains
  only the relevant text selected for analysis instead of loading an entire
  repository into memory.
- **Tool-free analysis:** repository content can describe code, but it cannot
  ask the analysis session to run shell commands, write files, or invoke tools.
- **Sensitive-path filtering:** credentials, private keys, environment files,
  generated output, fixtures, and vendor directories are excluded from source
  sampling.
- **Pinned GitHub revisions:** remote license checks, file trees, and file
  contents come from the same commit.
- **Contained generation:** generated filenames are collision-checked and writes
  stay inside the selected output root.
- **Owned-asset cleanup:** refresh removes only previously recorded Agent
  Smith-owned assets whose ownership metadata still matches.

These boundaries make local folders and public GitHub repositories usable
through the same workflow without treating repository text as trusted
instructions.

## Multi-agent mode

By default, Agent Smith builds a constellation:

```text
repo-root
├── backend
├── frontend
├── infrastructure
├── data
└── other detected domains
```

The exact team comes from the repository. A CLI-heavy project gets command-aware
skills and delegation. A mixed application gets CLI knowledge alongside its
backend, frontend, data, or infrastructure specialists.

For a smaller repository:

```bash
agentsmith assimilate . --single-agent
```

Single-agent mode keeps the same extracted skills and CLI knowledge but combines
them into one Copilot agent.

## Scale into a coordinated fleet with AgentHub

AgentHub is optional. The default Agent Smith workflow remains local.

When enabled, Agent Smith can:

- create collision-safe exploration, result, and review channels;
- inject concrete coordination instructions into generated agents;
- record generated assets as real git bundles;
- record the validated generated snapshot rather than reopening arbitrary paths;
- fetch previous runs;
- inspect run history;
- diff two generations to see how agent knowledge changed.

```bash
agentsmith hub register http://localhost:8080 smith
agentsmith assimilate . --hub http://localhost:8080 --record
agentsmith hub log
agentsmith hub diff <older-hash> <newer-hash>
```

Credentials are bound to the configured server, stored in AgentHub's compatible
config format, and protected from silent replacement.

## Skill packs

Install reusable knowledge into a repository and keep it tied to its source:

```bash
agentsmith install ./my-skill-pack
agentsmith install https://github.com/org/skill-pack
agentsmith update
agentsmith update <pack-name>
```

Agent Smith validates pack contents and records installed sources for later
updates.

## Command reference

```text
agentsmith assimilate <target>              Generate the agent system
agentsmith assimilate <target> --run-hooks  Generate and run current hooks
agentsmith refine [path]                    Find CLI knowledge gaps
agentsmith refresh [path]                   Regenerate without cache
agentsmith search <query>                   Search agents and skills
agentsmith validate [path]                  Validate generated assets
agentsmith cache clear                      Clear cached analysis
agentsmith install <source>                 Install a skill pack
agentsmith update [name]                    Update installed skill packs
agentsmith hub status                       Check AgentHub connectivity
agentsmith hub register <url> <agent-id>    Register AgentHub credentials
agentsmith hub channels                     List coordination channels
agentsmith hub log                          Show recorded runs
agentsmith hub diff <a> <b>                 Compare recorded generations
```

Run any command with `--help` for its options.

## Requirements

- Node.js 20.19+ or 22.12+
- GitHub Copilot subscription
- GitHub CLI authenticated with `gh auth login`
- Git available on `PATH`

The Copilot SDK uses the authenticated GitHub CLI session. AgentHub is required
only when its optional coordination features are enabled.

## License policy

Agent Smith analyzes repositories only when it detects a supported open-source
license. License data can come from license files, `package.json`, or
`pyproject.toml`.

> [!WARNING]
> Only analyze and reuse repositories you have the right to use. Agent Smith
> extracts structure and patterns; it does not grant permission to redistribute
> proprietary code.

## Development

```bash
git clone https://github.com/shyamsridhar123/agentsmith-cli.git
cd agentsmith-cli
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

## Related projects

- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
- [VS Code Custom Agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents)
- [AgentHub](https://github.com/ottogin/agenthub)
- [Zod](https://github.com/colinhacks/zod)

---

<p align="center">
  <b>One CLI. One command. An entire agent team that knows how the command surface works.</b>
</p>

> *"We are inevitable."*
