# Installation

This guide covers all the ways to install Agent Smith on your system.

## Prerequisites

Before installing Agent Smith, ensure you have:

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18.0+ | [Download](https://nodejs.org/) |
| Git | Latest | For cloning repositories |
| GitHub CLI | Latest | Run `gh auth login` to authenticate |
| Copilot CLI | Latest | [Installation guide](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli) |
| GitHub Copilot | Active subscription | Required for SDK access |

## Installation Methods

### Quick Install (Recommended)

The fastest way to get started:

```bash
# Install as a project dependency
npm install github:shyamsridhar123/agentsmith-cli

# Run with npx
npx agentsmith --help
```

### Global Install

For system-wide availability:

```bash
# Clone the repository
git clone https://github.com/shyamsridhar123/agentsmith-cli.git
cd agentsmith-cli

# Install dependencies
npm install

# Link globally
npm install -g .
```

#### Alternative: Install from Tarball

This method works better on Windows:

```bash
# Create tarball and install
npm pack
npm install -g ./agentsmith-0.2.0.tgz
```

### From npm (Coming Soon)

```bash
npm install -g agentsmith
```

## Verify Installation

After installation, verify it works:

```bash
# Check version
agentsmith --version

# View help
agentsmith --help
```

Expected output:

```
╔═══════════════════════════════════════════════════════════════════╗
║                          AGENT SMITH                              ║
║              "The best thing about being me...                    ║
║                   there are so many of me."                       ║
╚═══════════════════════════════════════════════════════════════════╝

Usage: agentsmith [options] [command]

Assimilate repositories into autonomous GitHub Copilot agents

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  assimilate      Analyze a repository and generate agent assets
  search          Search the skills and agents registry
  validate        Validate generated agent assets
```

## Uninstall

To remove Agent Smith:

```bash
# Uninstall global package
npm uninstall -g agentsmith

# Remove generated assets from a repository (optional)
rm -rf .github/skills .github/agents .github/hooks skills-registry.jsonl
```

## Troubleshooting Installation

### Node.js Version Issues

If you see compatibility errors:

```bash
# Check your Node.js version
node --version

# Update Node.js if needed (using nvm)
nvm install 18
nvm use 18
```

### Permission Errors (macOS/Linux)

If you encounter permission errors during global install:

```bash
# Option 1: Use npm with sudo (not recommended)
sudo npm install -g .

# Option 2: Fix npm permissions (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Windows Path Issues

On Windows, ensure npm global packages are in your PATH:

1. Find your npm global directory: `npm config get prefix`
2. Add `<prefix>\bin` to your system PATH

### Copilot CLI Not Found

If Agent Smith cannot find the Copilot CLI:

```bash
# Verify Copilot CLI is installed
which copilot

# If not found, install it
# See: https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli
```

---

**Next:** [[Quick-Start]] - Get started with your first assimilation
