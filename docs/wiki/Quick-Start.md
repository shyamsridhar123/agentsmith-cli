# Quick Start Guide

Get up and running with Agent Smith in just a few minutes.

## Your First Assimilation

### Step 1: Navigate to Your Repository

```bash
cd /path/to/your/project
```

### Step 2: Run the Assimilate Command

```bash
agentsmith assimilate .
```

This will:
1. **Scan** your repository structure
2. **Analyze** code patterns using GitHub Copilot SDK
3. **Generate** skills, agents, and hooks
4. **Build** a searchable registry

### Step 3: Explore Generated Assets

After assimilation, you'll find new files in your repository:

```
.github/
├── skills/           # Extracted patterns and conventions
│   └── <skill-name>/
│       └── SKILL.md
├── agents/           # Agent configurations
│   ├── root/
│   │   └── agent.yaml
│   └── <sub-agent>/
│       └── agent.yaml
└── hooks/            # Lifecycle hooks
    ├── pre-commit-quality.yaml
    ├── pre-push-tests.yaml
    └── post-generate-validate.yaml

skills-registry.jsonl  # Searchable index
```

## Common Workflows

### Assimilate a GitHub Repository

```bash
# Analyze a public GitHub repository
agentsmith assimilate https://github.com/expressjs/express
```

### Preview Before Writing

Use `--dry-run` to see what would be generated without writing files:

```bash
agentsmith assimilate . --dry-run
```

### Verbose Output

Get detailed analysis information:

```bash
agentsmith assimilate . --verbose
```

### Custom Output Directory

Specify where to write generated assets:

```bash
agentsmith assimilate . --output ./my-agents
```

### Search the Registry

Find skills by keyword:

```bash
agentsmith search "error handling"
agentsmith search "authentication"
```

### Validate Generated Assets

Ensure all generated files are valid:

```bash
agentsmith validate
agentsmith validate .github/skills/  # Validate specific path
```

## Understanding the Output

### Skills

Each skill represents a reusable pattern or convention detected in your codebase:

```markdown
# .github/skills/error-handling/SKILL.md

---
name: error-handling
description: Graceful error handling patterns using try-catch with custom error classes
triggers:
  - error
  - exception
  - catch
---

## When to Use

Use this skill when implementing error handling logic...

## Pattern

```typescript
try {
  // operation
} catch (error) {
  if (error instanceof CustomError) {
    // handle known errors
  }
  throw error;
}
```
```

### Agents

Agents are configurations that define behavior and capabilities:

```yaml
# .github/agents/root/agent.yaml
name: project-agent
description: Primary agent for this repository
version: "1.0"

skills:
  - error-handling
  - api-design
  - testing

subAgents:
  - name: backend
    path: .github/agents/backend/
    triggers: ["api", "database", "server"]

tools:
  - name: build
    command: "npm run build"
  - name: test
    command: "npm test"
```

### Hooks

Lifecycle hooks run at specific events:

```yaml
# .github/hooks/pre-commit-quality.yaml
name: pre-commit-quality
event: pre-commit
commands:
  - npm run lint
  - npm run test
```

## Next Steps

1. **Explore your skills** — Review the generated SKILL.md files
2. **Customize agents** — Modify agent.yaml configurations as needed
3. **Run hooks** — Execute lifecycle hooks for quality checks
4. **Search patterns** — Use `agentsmith search` to find specific capabilities

---

**Next:** [[Commands]] - Complete CLI reference
