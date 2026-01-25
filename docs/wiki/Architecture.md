# Architecture

This document provides a technical overview of Agent Smith's architecture and how it works.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            AGENT SMITH CLI                               │
│                     "The best thing about being me...                    │
│                         there are so many of me."                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  INPUT                    PROCESSING                      OUTPUT        │
│  ─────                    ──────────                      ──────        │
│                                                                         │
│  ┌─────────┐    ┌────────────────────────────────┐    ┌─────────────┐  │
│  │  Local  │    │         THE SCANNER            │    │  .github/   │  │
│  │  Path   │───▶│  • File tree enumeration       │    │  ├─ skills/ │  │
│  └─────────┘    │  • Language detection          │    │  │  └─ */   │  │
│                 │  • Config file discovery       │    │  │    SKILL │  │
│  ┌─────────┐    └────────────┬───────────────────┘    │  ├─ agents/ │  │
│  │ GitHub  │                 │                        │  │  └─ */   │  │
│  │  URL    │───▶   ┌─────────▼─────────┐              │  └─ hooks/  │  │
│  └─────────┘       │    THE ANALYZER   │              └──────┬──────┘  │
│                    │  (Copilot SDK)    │                     │         │
│                    │                   │              ┌──────▼──────┐  │
│                    │  • Semantic       │              │   skills-   │  │
│                    │    understanding  │              │  registry   │  │
│                    │  • Pattern        │              │   .jsonl    │  │
│                    │    extraction     │              └─────────────┘  │
│                    │  • Relationship   │                               │
│                    │    mapping        │                               │
│                    └─────────┬─────────┘                               │
│                              │                                         │
│                    ┌─────────▼─────────┐                               │
│                    │   THE GENERATOR   │                               │
│                    │                   │                               │
│                    │  • SKILL.md files │                               │
│                    │  • Agent configs  │                               │
│                    │  • Tool defs      │                               │
│                    │  • Hooks          │                               │
│                    │  • Registry       │                               │
│                    └───────────────────┘                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. CLI Layer (`src/commands/`)

The CLI layer handles user input and orchestrates the pipeline:

- **Commander.js** — Command parsing and option handling
- **Chalk** — Styled terminal output with Matrix-themed banners
- **Input validation** — Path/URL detection and normalization

### 2. Scanner (`src/scanner/`)

The scanner enumerates and categorizes repository contents:

```
INPUT: Repository path
OUTPUT: ScanResult {
  files: string[]
  language: string
  framework: string
  configs: ConfigFile[]
  testFiles: string[]
  sourceFiles: string[]
}
```

**Responsibilities:**
- File tree enumeration (respects `.gitignore`)
- Primary language detection
- Framework identification
- Config file discovery (`package.json`, `tsconfig.json`, etc.)
- Source vs. test file classification

### 3. Analyzer (`src/analyzer/`)

The analyzer uses GitHub Copilot SDK for semantic understanding:

```
INPUT: ScanResult
OUTPUT: AnalysisResult {
  skills: SkillDefinition[]
  agents: AgentDefinition[]
  tools: ToolDefinition[]
  relationships: Relationship[]
}
```

**Copilot SDK Integration:**
- Creates a session with system context
- Multi-turn analysis with custom tools
- Pattern extraction through semantic reasoning
- Relationship mapping between components

### 4. Generator (`src/generator/`)

The generator writes structured assets:

```
INPUT: AnalysisResult
OUTPUT: Generated files in .github/
```

**Asset Types:**
- **SKILL.md** — Markdown with YAML frontmatter
- **agent.yaml** — Agent configuration
- **hook.yaml** — Lifecycle event handlers
- **skills-registry.jsonl** — Searchable index

### 5. Registry (`src/registry/`)

The registry provides fast skill/agent discovery:

- **JSONL format** — One entry per line for streaming
- **Relevance scoring** — Keyword and trigger matching
- **Type filtering** — Filter by skill or agent

### 6. Hooks (`src/hooks/`)

Lifecycle hooks execute at specific events:

- **pre-commit** — Before git commit
- **pre-push** — Before git push
- **post-generate** — After asset generation
- **post-analyze** — After code analysis

## Data Flow

```
1. INPUT          2. CLONE           3. SCAN           4. ANALYZE
   ─────             ─────              ────              ───────
   Path or URL  ──▶  Clone to temp  ──▶  Enumerate    ──▶  Copilot SDK
                     (if URL)           files             analysis

5. LICENSE        6. GENERATE        7. INDEX          8. HOOKS
   ───────           ────────           ─────             ─────
   Check          ──▶  Write assets  ──▶  Build        ──▶  Execute
   permissive        to .github/         registry          post-generate
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Runtime** | Node.js 18+ | Execution environment |
| **Language** | TypeScript 5+ | Type safety, modern syntax |
| **CLI** | Commander.js | Command parsing |
| **Styling** | Chalk | Terminal colors |
| **AI** | @github/copilot-sdk | Semantic analysis |
| **Git** | simple-git | Repository operations |
| **Schema** | Zod | Validation |
| **YAML** | yaml | Config parsing |

## Directory Structure

```
agentsmith-cli/
├── src/
│   ├── main.ts              # Entry point
│   ├── commands/            # CLI command handlers
│   │   ├── assimilate.ts
│   │   ├── search.ts
│   │   └── validate.ts
│   ├── scanner/             # Repository scanning
│   ├── analyzer/            # Copilot SDK analysis
│   ├── generator/           # Asset generation
│   ├── registry/            # Skills registry
│   ├── hooks/               # Lifecycle hooks
│   ├── github/              # GitHub integration
│   └── utils/               # Utilities
├── bin/
│   └── agentsmith.js        # CLI executable
├── docs/
│   ├── wiki/                # This documentation
│   ├── PHILOSOPHY.md        # Project philosophy
│   └── PRD.md               # Product requirements
└── package.json
```

## Agent Hierarchy

Agent Smith creates hierarchical agent structures:

```
root (Primary Agent)
├── core
│   └── views (Nested)
├── routing
├── request
├── response
└── utils
```

Each agent has:
- **Skills** — Reusable patterns it can apply
- **Tools** — Commands it can execute
- **Triggers** — Keywords that activate it
- **Sub-agents** — Specialized child agents

## Copilot SDK Usage

```typescript
import { CopilotClient, defineTool } from "@github/copilot-sdk";

const client = new CopilotClient();
await client.start();

const session = await client.createSession({
  model: "gpt-5",
  streaming: true,
  systemMessage: `You are Agent Smith. Your purpose: assimilate repositories.
    Analyze deeply. Extract patterns. Generate agents that embody the repo.`,
  tools: [
    defineTool("analyze_structure", {
      description: "Analyze repository file structure",
      parameters: z.object({ path: z.string() }),
      handler: analyzeStructure,
    }),
    defineTool("extract_skill", {
      description: "Extract a skill from patterns",
      parameters: z.object({
        name: z.string(),
        files: z.array(z.string()),
        purpose: z.string(),
      }),
      handler: extractSkill,
    }),
  ],
});
```

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| **Secrets in output** | Scan generated files for sensitive patterns |
| **Data exfiltration** | All analysis via local Copilot CLI |
| **Respect .gitignore** | Skip ignored files during scanning |
| **License compliance** | Only assimilate permissively licensed repos |

---

**Next:** [[Troubleshooting]] - Common issues and solutions
