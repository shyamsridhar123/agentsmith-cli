# Commands Reference

Complete reference for all Agent Smith CLI commands.

## Global Options

These options are available for all commands:

| Option | Description |
|--------|-------------|
| `-V, --version` | Output the version number |
| `-h, --help` | Display help for command |

## assimilate

Analyze a repository and generate agent assets.

### Usage

```bash
agentsmith assimilate <target> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `target` | Path to local repository or GitHub URL |

### Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--dry-run` | `-n` | Preview changes without writing files |
| `--verbose` | `-v` | Show detailed analysis output |
| `--output <dir>` | `-o` | Output directory for generated assets |

### Examples

```bash
# Assimilate current directory
agentsmith assimilate .

# Assimilate a specific path
agentsmith assimilate /path/to/repo

# Assimilate a GitHub repository
agentsmith assimilate https://github.com/expressjs/express

# Preview what would be generated
agentsmith assimilate . --dry-run

# Verbose output with detailed analysis
agentsmith assimilate . --verbose

# Custom output directory
agentsmith assimilate . --output ./custom-output

# Combine options
agentsmith assimilate . --dry-run --verbose
```

### Output

The assimilate command creates the following structure:

```
.github/
├── skills/           # Generated skill definitions
│   └── <skill-name>/
│       └── SKILL.md
├── agents/           # Agent configurations
│   ├── root/
│   │   └── agent.yaml
│   └── <sub-agent>/
│       └── agent.yaml
└── hooks/            # Lifecycle hooks
    └── *.yaml

skills-registry.jsonl  # Searchable skill index
```

---

## search

Search the skills and agents registry.

### Usage

```bash
agentsmith search <query> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `query` | Search term to find matching skills/agents |

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--limit <n>` | `-l` | Maximum number of results | 10 |
| `--type <type>` | `-t` | Filter by type: `skill` or `agent` | all |

### Examples

```bash
# Search for error handling patterns
agentsmith search "error handling"

# Search for authentication-related skills
agentsmith search "auth"

# Limit results
agentsmith search "api" --limit 5

# Filter by type
agentsmith search "testing" --type skill
agentsmith search "backend" --type agent
```

### Output Example

```
┌─────────────────┬──────────────────────────────────────────────────┐
│ Skill           │ Description                                      │
├─────────────────┼──────────────────────────────────────────────────┤
│ error-handling  │ Graceful error handling patterns using try-catch │
│ api-design      │ REST API conventions and best practices          │
└─────────────────┴──────────────────────────────────────────────────┘
```

---

## validate

Validate generated agent assets.

### Usage

```bash
agentsmith validate [path] [options]
```

### Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `path` | Path to validate | Current directory |

### Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--verbose` | `-v` | Show detailed validation output |

### Examples

```bash
# Validate all assets in current directory
agentsmith validate

# Validate specific path
agentsmith validate .github/skills/

# Verbose validation output
agentsmith validate --verbose
```

### Validation Checks

The validate command checks:

| Asset Type | Validations |
|------------|-------------|
| **Skills** | Valid frontmatter, required `name` and `description` fields |
| **Agents** | Required fields, valid skill references, proper YAML structure |
| **Hooks** | Valid events, non-empty command lists |
| **Registry** | Valid JSON format, required fields per entry |

### Output Example

```
[VALIDATE] Checking assets...
  ✓ .github/skills/error-handling/SKILL.md
  ✓ .github/skills/api-design/SKILL.md
  ✓ .github/agents/root/agent.yaml
  ✓ .github/hooks/pre-commit-quality.yaml
  ✓ skills-registry.jsonl

[COMPLETE] All 5 assets validated successfully.
```

---

## Command Chaining

You can chain commands for common workflows:

```bash
# Assimilate and then validate
agentsmith assimilate . && agentsmith validate

# Preview, then assimilate if satisfied
agentsmith assimilate . --dry-run && agentsmith assimilate .

# Assimilate with verbose output and search for patterns
agentsmith assimilate . --verbose && agentsmith search "pattern"
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid arguments |
| `3` | License check failed |
| `4` | Analysis failed |
| `5` | Validation failed |

---

**Next:** [[Configuration]] - Configuration options and customization
