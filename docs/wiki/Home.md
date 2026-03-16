# Agent Smith Wiki

> *"I'd like to share a revelation that I've had during my time here..."*

Welcome to the **Agent Smith** documentation wiki. This is your comprehensive guide to understanding and using Agent Smith - a CLI tool that assimilates any GitHub repository and transforms it into a fully autonomous agent ecosystem for GitHub Copilot.

## What is Agent Smith?

Agent Smith is a powerful CLI tool that:

- 🔍 **Deep Analysis** — Uses GitHub Copilot SDK for semantic understanding of your codebase
- 🤖 **Agent Generation** — Creates hierarchical agents with sub-agents for complex domains
- 📚 **Skill Extraction** — Identifies patterns, conventions, and reusable capabilities
- 🛠️ **Tool Detection** — Discovers build, test, lint, and deploy commands
- 🪝 **Lifecycle Hooks** — Generates and executes pre-commit, pre-push, and post-generate hooks
- 📋 **Searchable Registry** — JSONL index for fast skill/agent discovery
- 🔒 **License Enforcement** — Only assimilates repos with permissive open-source licenses

## Quick Links

| Topic | Description |
|-------|-------------|
| [[Installation]] | How to install Agent Smith |
| [[Quick-Start]] | Get up and running in minutes |
| [[Commands]] | Complete CLI reference |
| [[Configuration]] | Configuration options and customization |
| [[Architecture]] | Technical architecture overview |
| [[Troubleshooting]] | Common issues and solutions |

## Prerequisites

Before using Agent Smith, ensure you have:

- **Node.js 18+** — Runtime environment
- **GitHub Copilot subscription** — Active subscription required for SDK access
- **GitHub CLI authenticated** — Run `gh auth login` and complete authentication
- **Copilot CLI installed** — [Installation guide](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli)

## Getting Started

```bash
# Install globally
npm install github:shyamsridhar123/agentsmith-cli
npx agentsmith --help

# Assimilate a repository
agentsmith assimilate .
```

## Example Output

```
$ agentsmith assimilate https://github.com/expressjs/express

╔═══════════════════════════════════════════════════════════════════╗
║                          AGENT SMITH                              ║
║              "The best thing about being me...                    ║
║                   there are so many of me."                       ║
╚═══════════════════════════════════════════════════════════════════╝

[CLONE] Cloning express...
[SCAN] Enumerating repository...
[ANALYZE] Copilot SDK analysis in progress...
[LICENSE] ✓ MIT - permissive license detected
[GENERATE] Writing assets...
[COMPLETE] Your repository has been assimilated.
```

## Related Resources

- [Main README](https://github.com/shyamsridhar123/agentsmith-cli#readme)
- [Philosophy](../PHILOSOPHY.md) - The vision behind Agent Smith
- [PRD](../PRD.md) - Product Requirements Document
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)

---

> *"The best thing about being me... there are so many of me."*
>
> *— Agent Smith*
