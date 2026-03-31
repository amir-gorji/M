# Kitsune — Migration Agent

> **AI-powered PR-based migration guide generator for VS Code Copilot**

Kitsune is a GitHub Copilot Chat participant (`@kitsune`) that:

1. **Analyses a sample PR/MR** from any Git host (GitHub, Azure DevOps, GitLab, Bitbucket)
2. **Asks targeted clarifying questions** to understand your constraints, team, and preferences
3. **Generates a comprehensive, AI-ready migration playbook** (Markdown) that both human developers and AI agents can follow

---

## Features

| Feature | Details |
|---|---|
| **Multi-provider PR support** | GitHub, GitHub Enterprise, Azure DevOps (dev.azure.com + visualstudio.com), GitLab (cloud + self-hosted), Bitbucket Cloud, Bitbucket Server |
| **Intelligent pattern detection** | Recognises 15+ migration patterns (React 17→18, Redux Toolkit, Vue 3, TS migration, Vitest, Vite, Prisma→Drizzle, and more) |
| **AI-assisted deep analysis** | Uses GitHub Copilot to summarise the migration intent beyond what pattern matching can detect |
| **Contextual questionnaire** | Multi-turn conversation that collects your approach, scope, testing strategy, team size, rollback plan, and known pitfalls |
| **All migration strategies** | Step-by-step, big bang, vertical slice, and strangler fig — each with correct phase ordering |
| **Correct sequentiality** | Steps never try to solve problems that a later step will fix. References are updated before removals. |
| **Workspace scanning** | Counts migration targets in your open workspace using the detected search patterns |
| **Repeatable playbook** | The generated guide includes grep patterns, shell scripts, and per-file checklists so the migration can be applied consistently across the codebase |

---

## Getting Started

### Installation

Install from the VS Code Marketplace (or build from source — see Development below).

### Usage

Open GitHub Copilot Chat and type:

```
@kitsune https://github.com/your-org/your-repo/pull/42
```

Kitsune will:
1. Fetch and analyse the PR
2. Ask you 10–15 clarifying questions across several turns
3. Generate a `YYYY-MM-DD-migration-guide.md` in your `.kitsune/` directory

### Commands

| Command | Description |
|---|---|
| `@kitsune /analyze <url>` | Analyse a PR URL |
| `@kitsune /generate` | Generate the guide immediately with current answers |
| `@kitsune /scan` | Count migration targets in the workspace |
| `@kitsune /reset` | Start a fresh session |

---

## Supported PR Providers

| Provider | URL format |
|---|---|
| **GitHub** | `https://github.com/{owner}/{repo}/pull/{number}` |
| **GitHub Enterprise** | `https://{host}/{owner}/{repo}/pull/{number}` |
| **Azure DevOps** | `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}` |
| **Azure DevOps (legacy)** | `https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}` |
| **GitLab** | `https://gitlab.com/{namespace}/{repo}/-/merge_requests/{id}` |
| **GitLab (self-hosted)** | `https://{host}/{namespace}/{repo}/-/merge_requests/{id}` |
| **Bitbucket Cloud** | `https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}` |
| **Bitbucket Server** | `https://{host}/projects/{key}/repos/{repo}/pull-requests/{id}` |

### Authentication

For private repositories, configure tokens in VS Code Settings (`Ctrl+,`):

| Setting | Description |
|---|---|
| `kitsune.github.token` | GitHub personal access token |
| `kitsune.azureDevOps.token` | Azure DevOps PAT |
| `kitsune.gitlab.token` | GitLab personal access token |
| `kitsune.bitbucket.username` | Bitbucket username |
| `kitsune.bitbucket.appPassword` | Bitbucket app password |

---

## Migration Strategies

Kitsune supports all four proven migration approaches:

### Step-by-Step (Incremental)
Migrate one file at a time. CI must pass after each file. Safest option. Best for high-complexity migrations.

### Big Bang (All at Once)
Migrate the entire codebase in a single branch. Fastest but riskiest. Best for mechanical transformations with strong test coverage.

### Vertical Slice (Feature by Feature)
Migrate one complete feature (UI → logic → data) before moving to the next. Good balance of safety and speed.

### Strangler Fig (Progressive Replacement)
Run old and new code simultaneously, progressively routing traffic to the new implementation. Best for production-critical systems.

---

## Generated Guide Structure

```
# Migration Guide: [Old Tech] → [New Tech]

## Executive Summary
## Migration Analysis
  - Import changes
  - Dependency changes
  - File structure changes
## Impact Assessment
## Prerequisites
## Migration Approach
## Migration Playbook
  - Phase 1: Preparation (deps, config, types)
  - Phase 2: Compatibility layer (adapters, feature flags)
  - Phase 3: New implementation
  - Phase 4: File-by-file migration (correct dependency order)
  - Phase 5: Validation
  - Phase 6: Cleanup (remove old code, deps)
  - Phase 7: Documentation
## Finding Migration Targets (grep patterns + shell script)
## Common Pitfalls
## Rollback Plan
## Final Validation Checklist
## Migration Configuration (your answers)
```

Every step includes:
- Clear goal
- Shell commands (if applicable)
- **Acceptance criteria** — how to verify the step succeeded before proceeding

---

## Development

```bash
git clone https://github.com/amir-gorji/M
cd M
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

### Build

```bash
npm run compile      # One-time build
npm run watch        # Watch mode
npm run package      # Create .vsix
```

---

## Settings Reference

| Setting | Default | Description |
|---|---|---|
| `kitsune.outputDirectory` | `.kitsune` | Directory for generated guides |
| `kitsune.questionsPerBatch` | `4` | Questions per conversation turn |
| `kitsune.github.token` | — | GitHub PAT |
| `kitsune.azureDevOps.token` | — | Azure DevOps PAT |
| `kitsune.gitlab.token` | — | GitLab token |
| `kitsune.bitbucket.username` | — | Bitbucket username |
| `kitsune.bitbucket.appPassword` | — | Bitbucket app password |

---

## License

MIT
