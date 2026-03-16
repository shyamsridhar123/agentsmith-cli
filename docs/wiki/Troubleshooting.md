# Troubleshooting

Common issues and their solutions when using Agent Smith.

## Installation Issues

### "Command not found: agentsmith"

**Cause:** Agent Smith is not in your PATH.

**Solutions:**

1. **If installed with npx:**
   ```bash
   npx agentsmith --help
   ```

2. **If installed globally, check npm prefix:**
   ```bash
   npm config get prefix
   # Add <prefix>/bin to your PATH
   ```

3. **Reinstall globally:**
   ```bash
   npm uninstall -g agentsmith
   npm install -g .
   ```

### "Error: EACCES: permission denied"

**Cause:** npm doesn't have permission to install globally.

**Solution (macOS/Linux):**
```bash
# Create npm directory in home
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'

# Add to PATH (add to ~/.bashrc or ~/.zshrc)
export PATH=~/.npm-global/bin:$PATH

# Reinstall
npm install -g .
```

### "Node.js version not supported"

**Cause:** Node.js version is below 18.

**Solution:**
```bash
# Check version
node --version

# Update using nvm
nvm install 18
nvm use 18

# Or download from nodejs.org
```

## Runtime Issues

### "Copilot CLI not found"

**Cause:** The Copilot CLI is not installed or not in PATH.

**Solution:**
1. Install Copilot CLI: [Installation Guide](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli)
2. Verify installation:
   ```bash
   which copilot
   copilot --version
   ```
3. Ensure it's in your PATH

### "GitHub Copilot subscription required"

**Cause:** Active Copilot subscription is needed for SDK access.

**Solution:**
1. Ensure you have an active GitHub Copilot subscription
2. Authenticate GitHub CLI:
   ```bash
   gh auth login
   ```
3. Verify authentication:
   ```bash
   gh auth status
   ```

### "License check failed"

**Cause:** The repository doesn't have a permissive open-source license.

**Symptoms:**
```
[LICENSE] ✗ No LICENSE file found
[ERROR] Cannot assimilate repository without permissive license
```

**Solutions:**

1. **Add a LICENSE file** to your repository with a supported license
2. **Use --dry-run** to preview without license restrictions:
   ```bash
   agentsmith assimilate . --dry-run
   ```

**Supported Licenses:**
- MIT, ISC, Unlicense, CC0
- Apache-2.0, MPL-2.0
- BSD-2-Clause, BSD-3-Clause, 0BSD
- GPL-2.0, GPL-3.0, LGPL, AGPL

### "Analysis timeout"

**Cause:** Repository is too large or complex for analysis within time limits.

**Solutions:**

1. **Try a specific subdirectory:**
   ```bash
   agentsmith assimilate ./src
   ```

2. **Reduce repository size:**
   - Ensure large generated files are in `.gitignore`
   - Remove unnecessary files before analysis

3. **Use verbose mode** to see progress:
   ```bash
   agentsmith assimilate . --verbose
   ```

### "Failed to clone repository"

**Cause:** Network issues or invalid URL.

**Solutions:**

1. **Verify the URL is accessible:**
   ```bash
   git clone https://github.com/org/repo.git /tmp/test-clone
   ```

2. **Check network connectivity:**
   ```bash
   ping github.com
   ```

3. **For private repos** (not supported in MVP):
   - Only public repositories can be cloned via URL
   - Clone manually and use local path

## Validation Issues

### "Invalid skill frontmatter"

**Cause:** SKILL.md file has malformed YAML frontmatter.

**Example Error:**
```
[VALIDATE] ✗ .github/skills/my-skill/SKILL.md
  Error: Missing required field 'name'
```

**Solution:**

Ensure SKILL.md has valid frontmatter:
```markdown
---
name: skill-name
description: A brief description
---

# Content here
```

### "Invalid agent configuration"

**Cause:** agent.yaml has invalid structure.

**Solution:**

Verify required fields:
```yaml
name: agent-name
description: Agent description
```

### "Registry entry invalid"

**Cause:** Malformed JSON in skills-registry.jsonl.

**Solution:**

Each line must be valid JSON:
```jsonl
{"name":"skill","file":"path","description":"desc"}
```

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `ENOENT: no such file` | Path doesn't exist | Verify the path is correct |
| `EISDIR: illegal operation on directory` | Expected file, got directory | Check path points to file |
| `ECONNREFUSED` | Network connection failed | Check internet connectivity |
| `Unexpected token in JSON` | Invalid JSON format | Validate JSON syntax |
| `Cannot find module` | Missing dependency | Run `npm install` |

## Getting Help

### Debug Mode

Enable verbose output for debugging:
```bash
agentsmith assimilate . --verbose
```

### Check Generated Files

After assimilation, review generated files:
```bash
# List generated skills
ls -la .github/skills/

# View a skill
cat .github/skills/*/SKILL.md

# Check registry
cat skills-registry.jsonl | head -5
```

### Report Issues

If you encounter a bug:

1. **Gather information:**
   ```bash
   agentsmith --version
   node --version
   npm --version
   ```

2. **Create a minimal reproduction** if possible

3. **Open an issue** on GitHub with:
   - Error message
   - Steps to reproduce
   - Environment details

---

## FAQ

### Q: Can I assimilate private repositories?

**A:** Currently, only public repositories can be assimilated via URL. For private repos, clone locally and use the path:
```bash
git clone git@github.com:org/private-repo.git
agentsmith assimilate ./private-repo
```

### Q: How many skills are typically generated?

**A:** It depends on the repository size and complexity. Typically:
- Small repos (< 5k LOC): 3-5 skills
- Medium repos (5k-50k LOC): 5-15 skills
- Large repos (> 50k LOC): 10-25 skills

### Q: Can I customize generated assets?

**A:** Yes! Generated files are meant to be starting points. Edit:
- SKILL.md files to refine patterns
- agent.yaml to adjust behavior
- hooks to customize lifecycle events

### Q: What languages are supported?

**A:** Agent Smith works best with:
- TypeScript/JavaScript
- Python
- Go
- Java

Other languages work but may have less detailed pattern extraction.

### Q: How do I update generated assets?

**A:** Re-run assimilation:
```bash
agentsmith assimilate .
```

Existing files will be overwritten. To preserve customizations, back them up first or use version control.

---

**Back to:** [[Home]] - Wiki home page
