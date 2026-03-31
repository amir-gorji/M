/**
 * Catalogue of all clarifying questions Kitsune may ask.
 * Questions are grouped by category and may have conditions.
 */

import type { MigrationAnalysis, Question, UserMigrationPreferences } from '../types.js';

// ─── Question bank ────────────────────────────────────────────────────────────

export const QUESTION_CATALOG: Question[] = [

  // ── Validation ─────────────────────────────────────────────────────────────

  {
    id: 'q_analysis_correct',
    category: 'validation',
    text: (analysis: MigrationAnalysis) =>
      `I analysed the PR and believe this migration moves from **${analysis.fromTechnology ?? 'the old approach'}** to **${analysis.toTechnology ?? 'the new approach'}**.\n\n` +
      `Key signals:\n${analysis.importChanges.slice(0, 3).map(ic => `- \`${ic.oldImport}\` → \`${ic.newImport}\``).join('\n') || '- (see diff above)'}\n\n` +
      `**Does this description match what you intended? What would you add or correct?**`,
    type: 'open-ended',
    prefKey: 'analysisNotes',
    required: true,
  } as unknown as Question,

  // ── Scope ──────────────────────────────────────────────────────────────────

  {
    id: 'q_scope',
    category: 'scope',
    text: 'What is the **migration scope**?\n\n' +
      'a) **All files** — migrate the entire codebase\n' +
      'b) **Specific modules** — only certain directories or packages\n' +
      'c) **Feature areas** — migrate feature by feature (e.g. auth first, then dashboard)',
    type: 'multiple-choice',
    options: ['a) All files', 'b) Specific modules', 'c) Feature areas'],
    prefKey: 'scope',
    required: true,
  },

  {
    id: 'q_scope_details',
    category: 'scope',
    text: 'Which **modules or directories** should be migrated? _(List paths or glob patterns, one per line. Leave empty if all.)_',
    type: 'open-ended',
    prefKey: 'scopeDetails',
    required: false,
    condition: (_a, prefs) => prefs.scope !== 'all',
  },

  {
    id: 'q_excluded_paths',
    category: 'scope',
    text: 'Are there any **files or directories that must NOT be migrated**? _(e.g. `legacy/`, `vendor/`, auto-generated files)_',
    type: 'open-ended',
    prefKey: 'excludedPaths',
    required: false,
  },

  // ── Approach ───────────────────────────────────────────────────────────────

  {
    id: 'q_approach',
    category: 'approach',
    text: 'Which **migration strategy** do you prefer?\n\n' +
      'a) **Step-by-step** — Migrate one file/module at a time. Safest. CI must pass after each file.\n' +
      'b) **Big bang** — Migrate everything in a single branch and merge at once. Fastest but riskiest.\n' +
      'c) **Vertical slice** — Migrate one full feature (e.g. UI → logic → data) before moving to the next.\n' +
      'd) **Strangler fig** — Keep old and new code running simultaneously. Gradually route traffic to new code.',
    type: 'multiple-choice',
    options: [
      'a) Step-by-step',
      'b) Big bang',
      'c) Vertical slice',
      'd) Strangler fig',
    ],
    prefKey: 'approach',
    required: true,
  },

  {
    id: 'q_coexistence',
    category: 'approach',
    text: 'Does the **old and new code need to coexist** for any period?\n\n' +
      'This is required when:\n' +
      '- You use feature flags to toggle between implementations\n' +
      '- You have parallel deployments (canary, blue/green)\n' +
      '- External consumers depend on the old API during transition',
    type: 'yes-no',
    options: ['Yes — they must coexist', 'No — full cut-over is fine'],
    prefKey: 'requiresCoexistence',
    required: true,
  },

  {
    id: 'q_coexistence_strategy',
    category: 'approach',
    text: 'How will you **manage coexistence**? _(e.g. feature flags, adapter pattern, dual-write, versioned endpoints)_',
    type: 'open-ended',
    prefKey: 'coexistenceStrategy',
    required: false,
    condition: (_a, prefs) => prefs.requiresCoexistence === true,
  },

  // ── Technical constraints ──────────────────────────────────────────────────

  {
    id: 'q_breaking_change',
    category: 'constraints',
    text: 'Is this migration a **breaking change for external consumers** of this code?\n\n' +
      '_(Public APIs, SDKs, design system packages, micro-frontends consumed by other teams)_',
    type: 'yes-no',
    options: ['Yes — external consumers will be affected', 'No — this is internal only'],
    prefKey: 'isBreakingForConsumers',
    required: true,
  },

  {
    id: 'q_source_review',
    category: 'technical',
    text: 'Does **each file need manual review** during migration, or can it be handled automatically?\n\n' +
      '- "Manual review required" = logic differences, not just syntax changes\n' +
      '- "Automated" = find-and-replace / codemod is sufficient',
    type: 'yes-no',
    options: ['Manual review required for each file', 'Automated codemod is sufficient'],
    prefKey: 'requiresSourceReview',
    required: true,
  },

  {
    id: 'q_testing_strategy',
    category: 'constraints',
    text: 'What is your **testing strategy** during migration?\n\n' +
      'a) **Unit tests first** — Update/write unit tests before migrating each file\n' +
      'b) **Integration tests first** — Keep integration tests green as the primary gate\n' +
      'c) **Parallel testing** — Run old and new test suites simultaneously\n' +
      'd) **E2E gated** — Each phase is gated on E2E tests passing',
    type: 'multiple-choice',
    options: [
      'a) Unit tests first',
      'b) Integration tests first',
      'c) Parallel testing',
      'd) E2E gated',
    ],
    prefKey: 'testingStrategy',
    required: true,
  },

  // ── Risk & rollback ────────────────────────────────────────────────────────

  {
    id: 'q_rollback',
    category: 'risk',
    text: 'What is your **rollback plan** if critical issues are found mid-migration?\n\n' +
      '_(e.g. "Revert the branch", "Use feature flag to disable", "Keep old code for 2 weeks")_',
    type: 'open-ended',
    prefKey: 'rollbackStrategy',
    required: true,
  },

  {
    id: 'q_known_pitfalls',
    category: 'risk',
    text: 'Are there any **known edge cases or pitfalls** you want the migration guide to cover?\n\n' +
      '_(e.g. "We have a custom plugin that hooks into X", "File A depends on runtime-generated types")_',
    type: 'open-ended',
    prefKey: 'knownPitfalls',
    required: false,
  },

  // ── Team & timeline ────────────────────────────────────────────────────────

  {
    id: 'q_team_size',
    category: 'team',
    text: 'How large is the **team performing this migration**?\n\n' +
      'a) **Solo** — one developer\n' +
      'b) **Small team** — 2–5 developers working in parallel\n' +
      'c) **Large team** — 6+ developers; coordination is needed',
    type: 'multiple-choice',
    options: ['a) Solo', 'b) Small team (2-5)', 'c) Large team (6+)'],
    prefKey: 'teamSize',
    required: true,
  },

  {
    id: 'q_timeline',
    category: 'team',
    text: 'What is the **migration timeline**?\n\n' +
      'a) **Immediate** — Complete in a single sprint or PR\n' +
      'b) **Gradual** — Roll out over several weeks/sprints\n' +
      'c) **Long-term** — This is an ongoing background effort',
    type: 'multiple-choice',
    options: ['a) Immediate (single sprint)', 'b) Gradual (weeks)', 'c) Long-term (months)'],
    prefKey: 'timeline',
    required: true,
  },

  // ── Additional context ─────────────────────────────────────────────────────

  {
    id: 'q_additional_notes',
    category: 'technical',
    text: 'Is there **anything else** you want the migration guide to address?\n\n' +
      '_(Architecture decisions, company standards, specific dependencies, CI/CD constraints)_',
    type: 'open-ended',
    prefKey: 'additionalNotes',
    required: false,
  },
];

// ─── Question selection ────────────────────────────────────────────────────────

/**
 * Select and order questions relevant to this specific analysis.
 * Always includes required questions; conditionally includes optional ones.
 */
export function selectQuestions(
  analysis: MigrationAnalysis,
  prefs: Partial<UserMigrationPreferences>
): Question[] {
  return QUESTION_CATALOG.filter(q => {
    const condition = (q as Question & { condition?: (a: MigrationAnalysis, p: Partial<UserMigrationPreferences>) => boolean }).condition;
    if (condition && !condition(analysis, prefs)) { return false; }
    return true;
  });
}

/**
 * Split questions into batches for multi-turn conversation.
 */
export function batchQuestions(questions: Question[], batchSize: number): Question[][] {
  const batches: Question[][] = [];
  for (let i = 0; i < questions.length; i += batchSize) {
    batches.push(questions.slice(i, i + batchSize));
  }
  return batches;
}
