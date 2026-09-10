# Configuration

Agent Smith can be customized through command-line options and configuration files.

## Command-Line Configuration

### Assimilation Options

| Option | Description | Default |
|--------|-------------|---------|
| `--dry-run` | Preview without writing files | `false` |
| `--verbose` | Show detailed output | `false` |
| `--output <dir>` | Output directory | `.github/` |

### Search Options

| Option | Description | Default |
|--------|-------------|---------|
| `--limit <n>` | Maximum results | `10` |
| `--type <type>` | Filter by skill or agent | all |

## Generated Asset Configuration

### Skills (SKILL.md)

Skills are defined using YAML frontmatter:

```markdown
---
name: skill-name
description: Brief description of the skill
triggers:
  - keyword1
  - keyword2
category: optional-category
---

# Skill Name

Detailed skill documentation...
```

#### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique skill identifier |
| `description` | Yes | Brief description (used in search) |
| `triggers` | No | Keywords that activate this skill |
| `category` | No | Grouping category |

### Agents (agent.yaml)

Agent configurations define behavior and capabilities:

```yaml
name: agent-name
description: Agent description
version: "1.0"

skills:
  - skill-name-1
  - skill-name-2

subAgents:
  - name: sub-agent-name
    path: .github/agents/sub-agent-name/
    triggers:
      - trigger1
      - trigger2

tools:
  - name: tool-name
    command: "command to execute"
    description: "What this tool does"

hooks:
  pre-commit:
    - lint
    - test
```

#### Agent Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent identifier |
| `description` | Yes | What this agent does |
| `version` | No | Version string |
| `skills` | No | List of skill names |
| `subAgents` | No | Nested agent definitions |
| `tools` | No | Executable commands |
| `hooks` | No | Lifecycle event handlers |

### Hooks (*.yaml)

Lifecycle hooks execute at specific events:

```yaml
name: hook-name
event: pre-commit
description: Optional description
commands:
  - npm run lint
  - npm run test
conditions:
  - file: "*.ts"
timeout: 300
```

#### Hook Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Hook identifier |
| `event` | Yes | Trigger event (see below) |
| `commands` | Yes | Commands to execute |
| `description` | No | Hook description |
| `conditions` | No | Conditional execution |
| `timeout` | No | Timeout in seconds |

#### Hook Events

| Event | When Triggered |
|-------|----------------|
| `pre-commit` | Before git commit |
| `pre-push` | Before git push |
| `post-generate` | After asset generation |
| `post-analyze` | After code analysis |

### Skills Registry (skills-registry.jsonl)

The registry is a JSONL file with one entry per line:

```jsonl
{"name":"skill-name","file":".github/skills/skill-name/SKILL.md","description":"Description","category":"category","triggers":["trigger1","trigger2"]}
```

#### Registry Entry Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Skill/agent name |
| `file` | Yes | Path to definition file |
| `description` | Yes | Searchable description |
| `category` | No | Grouping category |
| `triggers` | No | Activation keywords |

## License Policy

Agent Smith enforces license checks to ensure responsible use.

### Supported Licenses

The following licenses allow full assimilation:

| Category | Licenses |
|----------|----------|
| **Permissive** | MIT, ISC, Unlicense, CC0 |
| **Apache** | Apache-2.0 |
| **Mozilla** | MPL-2.0 |
| **BSD** | BSD-2-Clause, BSD-3-Clause, 0BSD |
| **GPL** | GPL-2.0, GPL-3.0, LGPL, AGPL |

### Blocked

- Repositories without a LICENSE file
- Proprietary or restrictive licenses

### Dry Run Override

Use `--dry-run` to preview generation for any repository without license restrictions:

```bash
agentsmith assimilate . --dry-run
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENTSMITH_OUTPUT` | Default output directory | `.github/` |
| `AGENTSMITH_VERBOSE` | Enable verbose mode | `false` |

## Customization Tips

### 1. Edit Generated Skills

After assimilation, you can manually edit SKILL.md files to:
- Add more detailed examples
- Refine trigger keywords
- Include additional context

### 2. Reorganize Agents

Modify the agent hierarchy by:
- Adding new sub-agents
- Changing trigger keywords
- Redefining tool commands

### 3. Add Custom Hooks

Create new hook files in `.github/hooks/`:

```yaml
name: custom-hook
event: pre-commit
commands:
  - your-custom-command
```

---

**Next:** [[Architecture]] - Technical architecture overview
