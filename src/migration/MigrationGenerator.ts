/**
 * Generates the final migration guide as a structured Markdown document.
 *
 * The output is designed to be used by BOTH human developers AND AI agents
 * (e.g. GitHub Copilot). Every step includes acceptance criteria so an AI
 * agent can verify completion before moving to the next step.
 */

import * as vscode from 'vscode';
import type {
  MigrationAnalysis,
  MigrationDocument,
  PRInfo,
  UserMigrationPreferences,
} from '../types.js';
import { buildPhases } from './StepSequencer.js';

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function generateMigrationGuide(
  pr: PRInfo,
  analysis: MigrationAnalysis,
  prefs: Partial<UserMigrationPreferences>,
): Promise<{
  document: MigrationDocument;
  markdown: string;
  filePath: string;
}> {
  const approach = prefs.approach ?? 'step-by-step';
  const phases = buildPhases(prefs, approach);

  const doc: MigrationDocument = {
    title: buildTitle(analysis),
    prUrl: pr.coordinates.url,
    approach,
    generatedAt: new Date(),
    analysis,
    preferences: prefs,
    phases,
    searchPatterns: analysis.searchPatterns,
    automationScript: buildAutomationScript(analysis),
    commonPitfalls: buildPitfalls(analysis, prefs),
    rollbackPlan: buildRollbackPlan(prefs),
    validationChecklist: buildValidationChecklist(analysis, prefs),
  };

  const markdown = renderMarkdown(doc, pr);
  const filePath = await saveGuide(markdown, doc.title);

  return { document: doc, markdown, filePath };
}

// ─── Title ────────────────────────────────────────────────────────────────────

function buildTitle(analysis: MigrationAnalysis): string {
  if (analysis.fromTechnology && analysis.toTechnology) {
    return `Migration: ${analysis.fromTechnology} → ${analysis.toTechnology}`;
  }
  const type = analysis.migrationTypes[0] ?? 'unknown';
  return `Migration Guide — ${type.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`;
}

// ─── Automation script ────────────────────────────────────────────────────────

function buildAutomationScript(analysis: MigrationAnalysis): string {
  const patterns = analysis.searchPatterns.filter((p) => p.regex);
  if (patterns.length === 0) {
    return '#!/bin/bash\n# No automated search patterns detected for this migration.';
  }

  const lines = [
    '#!/bin/bash',
    '# Kitsune: find-migration-targets.sh',
    '# Run this script from your project root to discover all files that need migration.',
    '',
    'set -e',
    'echo "Searching for migration targets..."',
    '',
  ];

  for (const p of patterns) {
    lines.push(`# ${p.description}`);
    if (p.regex) {
      const glob = p.fileGlob
        ? `--include="${p.fileGlob.replace('**/', '')}"`
        : '';
      lines.push(
        `echo "--- ${p.description} ---"`,
        `grep -rn "${p.regex.replace(/"/g, '\\"')}" ${glob} --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null | head -50`,
        '',
      );
    }
  }

  lines.push('echo "Done. Review the above files for migration targets."');
  return lines.join('\n');
}

// ─── Pitfalls ─────────────────────────────────────────────────────────────────

function buildPitfalls(
  analysis: MigrationAnalysis,
  prefs: Partial<UserMigrationPreferences>,
): import('../types.js').Pitfall[] {
  const pitfalls: import('../types.js').Pitfall[] = [
    {
      name: 'Deleting exports before updating all import sites',
      description:
        'Removing a function/type/module before all files that import it have been updated causes cascading TypeScript errors across the codebase.',
      avoidance:
        'Always update all consumers of a module before deleting or renaming the module. Use the search patterns in this guide to find every import site.',
    },
    {
      name: 'Fixing errors that belong to a future step',
      description:
        'When migrating file A, you may see type errors caused by un-migrated file B. Fixing them prematurely creates merge conflicts when B is later migrated.',
      avoidance:
        'Use `// @ts-ignore` or `// @ts-expect-error` sparingly to suppress cross-file errors that will be resolved when the dependent file is migrated. Remove these suppressions in Phase 6.',
    },
    {
      name: 'Ignoring transitive dependencies',
      description:
        'File C may not directly import the old library, but file A does, and C imports A. Migrating only A and C may still leave broken references.',
      avoidance:
        'Run a dependency graph analysis (`npx madge` or `npx depcruise`) to understand full transitive dependencies before determining migration order.',
    },
    ...(prefs.requiresCoexistence
      ? [
          {
            name: 'State desynchronisation during coexistence',
            description:
              'When old and new code share state (cache, database, session), writes from one can break the other.',
            avoidance:
              'Use an adapter or dual-write strategy to keep state in sync. Test all combinations of old/new code paths reading and writing state.',
          },
        ]
      : []),
    ...(prefs.approach === 'big-bang'
      ? [
          {
            name: 'Untested migration',
            description:
              'Migrating without running tests per file makes it hard to locate the source of regressions.',
            avoidance:
              'Even with a big-bang approach, run the test suite after each major phase to catch regressions early.',
          },
        ]
      : []),
  ];

  // Add developer-specified pitfalls
  for (const p of prefs.knownPitfalls ?? []) {
    pitfalls.push({
      name: 'Developer-identified pitfall',
      description: p,
      avoidance: "See your team's internal documentation.",
    });
  }

  return pitfalls;
}

// ─── Rollback plan ────────────────────────────────────────────────────────────

function buildRollbackPlan(prefs: Partial<UserMigrationPreferences>): string[] {
  const custom = prefs.rollbackStrategy
    ? [`**Team-specified rollback strategy**: ${prefs.rollbackStrategy}`]
    : [];

  return [
    ...custom,
    'Keep the migration on a dedicated branch until fully validated.',
    'If critical issues are found after merge, use `git revert` to undo the migration commits.',
    ...(prefs.requiresCoexistence
      ? [
          'Toggle the feature flag to route 100% traffic back to the old implementation.',
        ]
      : []),
    'Pin dependencies to the old versions in `package.json` as an emergency fallback.',
    'Keep the migration guide in `docs/migrations/` so future rollbacks can reference the original state.',
  ];
}

// ─── Validation checklist ─────────────────────────────────────────────────────

function buildValidationChecklist(
  analysis: MigrationAnalysis,
  prefs: Partial<UserMigrationPreferences>,
): string[] {
  return [
    '`tsc --noEmit` exits with code 0 (zero type errors)',
    'ESLint exits with code 0 (zero lint errors)',
    'All unit tests pass',
    'All integration tests pass',
    ...(prefs.testingStrategy === 'e2e-gated' ||
    prefs.testingStrategy === 'parallel'
      ? ['All E2E tests pass']
      : []),
    ...(analysis.isBreakingChange
      ? [
          'External API consumers have been notified and tested against the new API',
        ]
      : []),
    'No `// @ts-ignore` or `// @ts-expect-error` comments remain (added during migration)',
    'No old import patterns remain (re-run search patterns from this guide)',
    'Old dependencies have been removed from `package.json`',
    'README and documentation are updated',
    ...(prefs.teamSize === 'large'
      ? ['Migration guide has been reviewed by the team lead']
      : []),
    'Performance benchmark is within acceptable range',
    'Staging environment is healthy',
  ];
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(doc: MigrationDocument, pr: PRInfo): string {
  const { analysis, preferences: prefs, phases } = doc;
  const date = doc.generatedAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lines: string[] = [
    `# ${doc.title}`,
    '',
    `> **Generated by Kitsune Migration Agent** on ${date}`,
    `> Sample PR: [${pr.title}](${doc.prUrl})`,
    `> Migration approach: **${formatApproach(doc.approach)}**`,
    `> Complexity estimate: **${analysis.complexity}**`,
    '',
    '---',
    '',

    // ── Executive Summary ──────────────────────────────────────────────────
    '## Executive Summary',
    '',
    analysis.summary,
    '',
    analysis.fromTechnology && analysis.toTechnology
      ? `This guide covers migrating from **${analysis.fromTechnology}** to **${analysis.toTechnology}**.`
      : '',
    '',

    // ── Analysis ────────────────────────────────────────────────────────────
    '## Migration Analysis',
    '',
    '### What the Sample PR Demonstrates',
    '',
    `The sample PR (\`${pr.sourceBranch}\` → \`${pr.targetBranch}\`) modifies **${pr.files.length} file(s)** and shows:`,
    '',
    ...analysis.migrationTypes.map((t) => `- ${formatMigrationType(t)}`),
    '',
  ];

  if (analysis.importChanges.length > 0) {
    lines.push('### Import Changes', '');
    lines.push('| Old import | New import |');
    lines.push('|---|---|');
    for (const ic of analysis.importChanges.slice(0, 10)) {
      lines.push(`| \`${ic.oldImport}\` | \`${ic.newImport}\` |`);
    }
    lines.push('');
  }

  if (analysis.dependencyChanges.length > 0) {
    lines.push('### Dependency Changes', '');
    for (const dc of analysis.dependencyChanges) {
      const ver =
        dc.oldVersion && dc.newVersion
          ? ` (${dc.oldVersion} → ${dc.newVersion})`
          : dc.newVersion
            ? ` (${dc.newVersion})`
            : '';
      lines.push(`- **${dc.type.toUpperCase()}**: \`${dc.name}\`${ver}`);
    }
    lines.push('');
  }

  if (analysis.fileChanges.length > 0) {
    lines.push('### File Structure Changes', '');
    for (const fc of analysis.fileChanges) {
      lines.push(
        `- **${fc.type.toUpperCase()}**: \`${fc.newPath}\`` +
          (fc.oldPath ? ` (was \`${fc.oldPath}\`)` : ''),
      );
    }
    lines.push('');
  }

  // ── Impact ─────────────────────────────────────────────────────────────
  lines.push(
    '## Impact Assessment',
    '',
    `| Attribute | Value |`,
    `|---|---|`,
    `| Migration type | ${analysis.migrationTypes.map(formatMigrationType).join(', ')} |`,
    `| Complexity | ${analysis.complexity} |`,
    `| Affected file types | ${analysis.affectedExtensions.join(', ') || 'N/A'} |`,
    `| Breaking change | ${analysis.isBreakingChange ? 'Yes' : 'No'} |`,
    `| Requires coexistence | ${analysis.requiresCoexistence ? 'Yes' : 'No'} |`,
    `| Requires source review | ${analysis.requiresSourceReview ? 'Yes (manual review per file)' : 'No (codemod may suffice)'} |`,
    analysis.estimatedTargetCount !== undefined
      ? `| Estimated target files | ~${analysis.estimatedTargetCount} |`
      : '',
    '',
  );

  if (analysis.exampleFiles.length > 0) {
    lines.push('### Reference Files from Sample PR', '');
    lines.push('Study these files to understand the migration pattern:');
    for (const f of analysis.exampleFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  // ── Prerequisites ──────────────────────────────────────────────────────
  lines.push(
    '## Prerequisites',
    '',
    'Complete these before starting the migration:',
    '',
    '- [ ] Read through this guide completely',
    '- [ ] Ensure the test suite passes on the current `main` branch',
    '- [ ] Create a migration branch: `git checkout -b migration/<name>`',
    '- [ ] Communicate the migration plan to the team',
    ...(analysis.isBreakingChange
      ? ['- [ ] Notify external consumers of upcoming breaking changes']
      : []),
    '',
  );

  // ── Approach ───────────────────────────────────────────────────────────
  lines.push(
    `## Migration Approach: ${formatApproach(doc.approach)}`,
    '',
    approachDescription(doc.approach),
    '',
    '### Why this approach?',
    '',
    prefs.approachRationale || approachRationale(doc.approach, analysis),
    '',
    '---',
    '',
  );

  // ── Phases and steps ───────────────────────────────────────────────────
  lines.push('## Migration Playbook', '');
  lines.push(
    '> **For AI agents**: Execute each step in order. After completing a step, verify the',
    '> acceptance criteria before proceeding. If a step fails, fix the issue in the **current**',
    '> step — do not skip ahead. Steps in later phases may resolve issues that appear in earlier',
    '> phases, but only if the dependency order is maintained.',
    '',
  );

  for (const phase of phases) {
    lines.push(`### ${phase.name}`, '');
    lines.push(`**Goal**: ${phase.goal}`, '');

    for (const s of phase.steps) {
      lines.push(`#### Step ${s.id}: ${s.title}`, '');
      if (s.risk !== 'none') {
        lines.push(`> ⚠️ **Risk level**: ${s.risk}`, '');
      }
      if (s.description) {
        lines.push(s.description, '');
      }
      if (s.commands && s.commands.length > 0) {
        lines.push('```bash');
        lines.push(...s.commands);
        lines.push('```', '');
      }
      if (s.codeChanges && s.codeChanges.length > 0) {
        for (const cc of s.codeChanges) {
          if (cc.description) {
            lines.push(cc.description, '');
          }
          if (cc.before && cc.after) {
            lines.push(`**Before:**`);
            lines.push(`\`\`\`${cc.language ?? ''}`);
            lines.push(cc.before);
            lines.push('```', '');
            lines.push(`**After:**`);
            lines.push(`\`\`\`${cc.language ?? ''}`);
            lines.push(cc.after);
            lines.push('```', '');
          }
        }
      }
      lines.push(`**Acceptance criteria**: ${s.verification}`, '');
    }
  }

  // ── Finding migration targets ──────────────────────────────────────────
  if (analysis.searchPatterns.length > 0) {
    lines.push(
      '---',
      '',
      '## Finding Migration Targets',
      '',
      'Use these patterns to discover all files that need migration.',
      '',
      '### VS Code Search',
      '',
    );
    for (const p of analysis.searchPatterns) {
      if (p.regex) {
        lines.push(`**${p.description}**`);
        lines.push(`- Search term: \`${p.regex}\``);
        lines.push(`- Files to include: \`${p.fileGlob}\``);
        lines.push('');
      }
    }

    lines.push(
      '### Shell Script',
      '',
      '```bash',
      doc.automationScript,
      '```',
      '',
    );
  }

  // ── Common pitfalls ────────────────────────────────────────────────────
  lines.push('---', '', '## Common Pitfalls', '');
  for (let i = 0; i < doc.commonPitfalls.length; i++) {
    const p = doc.commonPitfalls[i]!;
    lines.push(
      `### ${i + 1}. ${p.name}`,
      '',
      p.description,
      '',
      `**Avoidance**: ${p.avoidance}`,
      '',
    );
  }

  // ── Rollback plan ──────────────────────────────────────────────────────
  lines.push(
    '---',
    '',
    '## Rollback Plan',
    '',
    'If critical issues are found after migration:',
    '',
    ...doc.rollbackPlan.map((r) => `- ${r}`),
    '',
  );

  // ── Validation checklist ───────────────────────────────────────────────
  lines.push(
    '---',
    '',
    '## Final Validation Checklist',
    '',
    'Complete all items before considering the migration done:',
    '',
    ...doc.validationChecklist.map((item) => `- [ ] ${item}`),
    '',
  );

  // ── Preferences summary ────────────────────────────────────────────────
  lines.push(
    '---',
    '',
    '## Migration Configuration',
    '',
    '_This section records the answers collected by Kitsune to tailor this guide._',
    '',
    `| Setting | Value |`,
    `|---|---|`,
    `| Approach | ${formatApproach(doc.approach)} |`,
    `| Scope | ${prefs.scope ?? 'all'} |`,
    `| Testing strategy | ${prefs.testingStrategy ?? 'unit-first'} |`,
    `| Team size | ${prefs.teamSize ?? 'N/A'} |`,
    `| Timeline | ${prefs.timeline ?? 'N/A'} |`,
    `| Breaking for consumers | ${prefs.isBreakingForConsumers ? 'Yes' : 'No'} |`,
    `| Requires source review | ${prefs.requiresSourceReview ? 'Yes' : 'No'} |`,
    '',
    prefs.additionalNotes
      ? `**Additional notes from the developer:**\n\n${prefs.additionalNotes}\n`
      : '',
    '',
    '---',
    '',
    '_Generated by [Kitsune Migration Agent](https://github.com/amir-gorji/M) for GitHub Copilot_',
  );

  return lines.filter((l) => l !== undefined).join('\n');
}

// ─── File saving ──────────────────────────────────────────────────────────────

async function saveGuide(markdown: string, title: string): Promise<string> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.[0]) {
    throw new Error(
      'No workspace is open. Please open a folder and try again.',
    );
  }

  const cfg = vscode.workspace.getConfiguration('kitsune');
  const outputDir = cfg.get<string>('outputDirectory') ?? '.kitsune';
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `${timestamp}-${slug}.md`;

  const dirUri = vscode.Uri.joinPath(workspaceFolders[0].uri, outputDir);
  const fileUri = vscode.Uri.joinPath(dirUri, filename);

  await vscode.workspace.fs.createDirectory(dirUri);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(markdown, 'utf-8'));

  return fileUri.fsPath;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatApproach(approach: string): string {
  switch (approach) {
    case 'step-by-step':
      return 'Step-by-Step (Incremental)';
    case 'big-bang':
      return 'Big Bang (All at Once)';
    case 'vertical-slice':
      return 'Vertical Slice (Feature by Feature)';
    case 'strangler-fig':
      return 'Strangler Fig (Progressive Replacement)';
    default:
      return approach;
  }
}

function approachDescription(approach: string): string {
  switch (approach) {
    case 'step-by-step':
      return (
        'Migrate one file at a time. After each file, the CI must be green. ' +
        'This is the safest approach: regressions are caught immediately and rollback is trivial (revert one commit).'
      );
    case 'big-bang':
      return (
        'Migrate the entire codebase in a single branch. ' +
        'Fastest approach but highest risk. Requires thorough validation before merge. ' +
        'Best when the migration is purely mechanical (e.g. a codemod) and the codebase has strong test coverage.'
      );
    case 'vertical-slice':
      return (
        'Migrate one complete feature (from UI to data layer) before moving to the next. ' +
        'Balances risk and speed. Each slice can be reviewed and tested independently.'
      );
    case 'strangler-fig':
      return (
        'Run the old and new code simultaneously, gradually routing more traffic to the new implementation. ' +
        'Safest for production systems. Allows instant rollback at any point by switching routing.'
      );
    default:
      return '';
  }
}

function approachRationale(
  approach: string,
  analysis: MigrationAnalysis,
): string {
  if (approach === 'step-by-step') {
    return analysis.complexity === 'high'
      ? 'Given the high complexity of this migration, the step-by-step approach minimises risk and provides clear rollback points.'
      : 'The step-by-step approach was selected as it provides maximum safety with clear per-file acceptance criteria.';
  }
  if (approach === 'big-bang') {
    return 'This approach was selected. Ensure you have strong test coverage before proceeding.';
  }
  if (approach === 'vertical-slice') {
    return 'Vertical slicing allows each feature team to own their migration independently, reducing coordination overhead.';
  }
  if (approach === 'strangler-fig') {
    return 'The strangler fig pattern was selected to minimise production risk, allowing instant rollback via routing.';
  }
  return '';
}

function formatMigrationType(t: string): string {
  return t
    .split('-')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}
