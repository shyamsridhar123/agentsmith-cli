# Branch Protection Rules

> *"Order through protection. Structure through rules."*

This document outlines the recommended branch protection rules for the Agent Smith repository to ensure code quality, security, and collaboration best practices.

---

## Overview

Branch protection rules help enforce workflows and prevent accidental or unauthorized changes to important branches. For Agent Smith, we recommend protecting the `main` branch with the following settings.

---

## Recommended Rules for `main` Branch

### 1. Require Pull Request Reviews

| Setting | Recommended Value |
|---------|-------------------|
| **Require a pull request before merging** | ✅ Enabled |
| **Required approving reviews** | 1 (minimum) |
| **Dismiss stale pull request approvals when new commits are pushed** | ✅ Enabled |
| **Require review from code owners** | ✅ Enabled (if CODEOWNERS file exists) |
| **Require approval of the most recent reviewable push** | ✅ Enabled |

**Why:** Ensures all changes are reviewed by at least one other developer before being merged, catching bugs and maintaining code quality.

### 2. Require Status Checks

| Setting | Recommended Value |
|---------|-------------------|
| **Require status checks to pass before merging** | ✅ Enabled |
| **Require branches to be up to date before merging** | ✅ Enabled |

**Required status checks:**
- `build` — Ensures the project compiles successfully
- `lint` — Verifies code style and formatting
- `test` — Runs the test suite

**Why:** Prevents broken code from being merged into the main branch.

### 3. Require Conversation Resolution

| Setting | Recommended Value |
|---------|-------------------|
| **Require conversation resolution before merging** | ✅ Enabled |

**Why:** Ensures all review comments are addressed before merging.

### 4. Require Signed Commits

| Setting | Recommended Value |
|---------|-------------------|
| **Require signed commits** | ⚡ Optional (Recommended for high-security environments) |

**Why:** Verifies the identity of contributors and prevents commit spoofing.

### 5. Require Linear History

| Setting | Recommended Value |
|---------|-------------------|
| **Require linear history** | ✅ Enabled |

**Why:** Maintains a clean, readable commit history by requiring squash or rebase merges.

### 6. Restrict Push Access

| Setting | Recommended Value |
|---------|-------------------|
| **Restrict who can push to matching branches** | ✅ Enabled |
| **Allow force pushes** | ❌ Disabled |
| **Allow deletions** | ❌ Disabled |

**Why:** Prevents accidental force pushes or branch deletions that could destroy history.

### 7. Lock Branch (Optional)

| Setting | Recommended Value |
|---------|-------------------|
| **Lock branch** | ❌ Disabled (unless in maintenance mode) |

**Why:** Only enable when the branch should be completely read-only.

---

## How to Configure

### Via GitHub Web UI

1. Navigate to your repository on GitHub
2. Go to **Settings** → **Branches**
3. Under "Branch protection rules", click **Add rule**
4. Enter `main` as the branch name pattern
5. Configure the settings as recommended above
6. Click **Create** or **Save changes**

### Via GitHub CLI

```bash
# Create branch protection rule for main branch
gh api repos/{owner}/{repo}/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["build","lint","test"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"dismiss_stale_reviews":true,"require_code_owner_reviews":true,"required_approving_review_count":1}' \
  --field restrictions=null \
  --field required_linear_history=true \
  --field allow_force_pushes=false \
  --field allow_deletions=false
```

### Via Terraform (Infrastructure as Code)

```hcl
resource "github_branch_protection" "main" {
  repository_id = github_repository.agentsmith.node_id
  pattern       = "main"

  required_status_checks {
    strict   = true
    contexts = ["build", "lint", "test"]
  }

  required_pull_request_reviews {
    dismiss_stale_reviews           = true
    require_code_owner_reviews      = true
    required_approving_review_count = 1
  }

  enforce_admins         = true
  require_signed_commits = false
  required_linear_history = true
  allow_force_pushes     = false
  allow_deletions        = false
}
```

---

## Additional Recommendations

### CODEOWNERS File

Create a `.github/CODEOWNERS` file to automatically assign reviewers:

```
# Default owners for everything in the repo
* @shyamsridhar123

# Specific ownership for core source files
/src/ @shyamsridhar123
/bin/ @shyamsridhar123

# Documentation
/docs/ @shyamsridhar123
*.md @shyamsridhar123
```

### Protected Tags

Consider protecting release tags to prevent accidental deletion:

```bash
# Protect tags matching v* pattern
gh api repos/{owner}/{repo}/rulesets \
  --method POST \
  --field name="Protect release tags" \
  --field target="tag" \
  --field enforcement="active" \
  --field conditions='{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}}'
```

### Branch Naming Conventions

Enforce branch naming conventions through rulesets:

| Pattern | Purpose |
|---------|---------|
| `feature/*` | New features |
| `fix/*` | Bug fixes |
| `docs/*` | Documentation updates |
| `refactor/*` | Code refactoring |
| `chore/*` | Maintenance tasks |
| `release/*` | Release preparation |

---

## Security Considerations

### For Public Repositories

- **Require status checks** to prevent malicious PRs from being merged
- **Dismiss stale reviews** to ensure new commits are reviewed
- **Disable force pushes** to maintain audit trail

### For Private Repositories with Multiple Contributors

- **Require code owner reviews** for sensitive files
- **Enable signed commits** for verified contributor identity
- **Restrict push access** to maintainers only

---

## Troubleshooting

### "Status check is required but not found"

Ensure your CI workflow jobs have matching names:

```yaml
# .github/workflows/ci.yml
jobs:
  build:    # This name must match the required status check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run build
```

### "Branch is out of date"

When "Require branches to be up to date before merging" is enabled:

```bash
# Update your branch with main
git fetch origin
git rebase origin/main
# or
git merge origin/main
```

### "Require approving reviews" blocking admins

If admins should bypass rules:

1. Disable **"Do not allow bypassing the above settings"**
2. Or add admin to the bypass list in repository rulesets

---

## References

- [GitHub Docs: Managing a branch protection rule](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)
- [GitHub Docs: About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Docs: About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)

---

> *"Structure protects. Rules enable freedom within boundaries."*
>
> *— The Architect*
