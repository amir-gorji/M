/**
 * Ensures migration steps are ordered correctly so that:
 *  1. Dependencies are installed before they are used.
 *  2. Type definitions / interfaces are created before implementations.
 *  3. Import references are updated before the old export is removed.
 *  4. New implementations are written before callers are migrated.
 *  5. Tests are migrated alongside (or after) the code they test.
 *  6. Old code / dependencies are removed last.
 *  7. Documentation is updated last.
 *
 * The sequencer never tries to resolve a problem that a later step will fix.
 */

import type { MigrationPhase, MigrationStep, UserMigrationPreferences } from '../types.js';

// ─── Phase ordering ────────────────────────────────────────────────────────────

export type PhaseName =
  | 'preparation'
  | 'compatibility-layer'
  | 'new-implementation'
  | 'migration'
  | 'validation'
  | 'cleanup'
  | 'documentation';

const PHASE_ORDER: PhaseName[] = [
  'preparation',
  'compatibility-layer',
  'new-implementation',
  'migration',
  'validation',
  'cleanup',
  'documentation',
];

// ─── Phase definitions ────────────────────────────────────────────────────────

export function buildPhases(
  prefs: Partial<UserMigrationPreferences>,
  approach: UserMigrationPreferences['approach']
): MigrationPhase[] {
  switch (approach) {
    case 'big-bang':
      return buildBigBangPhases(prefs);
    case 'vertical-slice':
      return buildVerticalSlicePhases(prefs);
    case 'strangler-fig':
      return buildStranglerFigPhases(prefs);
    default:
      return buildStepByStepPhases(prefs);
  }
}

// ─── Step-by-step phases ───────────────────────────────────────────────────────

function buildStepByStepPhases(prefs: Partial<UserMigrationPreferences>): MigrationPhase[] {
  return [
    {
      id: 'preparation',
      name: 'Phase 1 — Preparation',
      goal: 'Set up the environment so the new code can compile alongside the old code without errors.',
      steps: [
        step('1.1', 'Create a dedicated migration branch',
          'Create an isolated branch to contain all migration work.',
          ['git checkout -b migration/$(date +%Y%m%d)-<migration-name>'],
          undefined,
          'Branch exists and CI is green on the branch.',
          false, 'none'),

        step('1.2', 'Install new dependencies',
          'Add the new library/framework packages. ' +
          'Do NOT remove old ones yet — they are still needed during transition.',
          undefined,
          undefined,
          'Running `npm install` (or equivalent) succeeds. `package.json` lists new deps.',
          true, 'low'),

        step('1.3', 'Update configuration files',
          'Update tooling configs (tsconfig, vite.config, jest.config, etc.) to support the new approach. ' +
          'Use forward-compatible settings where possible so old code still compiles.',
          undefined,
          undefined,
          'Project builds without errors: `npm run build`.',
          true, 'medium'),

        step('1.4', 'Create shared type definitions',
          'Define new interfaces, types, or schemas introduced by the migration. ' +
          'Place them in a shared location that both old and new code can import. ' +
          '**Do not delete old types yet.**',
          undefined,
          undefined,
          'TypeScript compiles with `tsc --noEmit`. No new type errors.',
          true, 'low'),

        ...(prefs.requiresSourceReview ? [
          step('1.5', 'Audit source files for migration targets',
            'Run the search patterns below to identify every file that needs to change. ' +
            'Record the list — this becomes your migration checklist.',
            undefined,
            undefined,
            'A list of target files is recorded (e.g. in a scratch file or issue).',
            false, 'none'),
        ] : []),
      ],
    },

    {
      id: 'compatibility-layer',
      name: 'Phase 2 — Compatibility Layer',
      goal: 'Create thin adapters so new code can call old code (and vice versa) without breaking either.',
      steps: [
        step('2.1', 'Implement adapter / wrapper if needed',
          'If old and new APIs are fundamentally different, create an adapter that new code can call ' +
          'while still delegating to the old implementation. ' +
          'This lets you migrate call sites before re-implementing the core.',
          undefined,
          undefined,
          'New adapter compiles. Existing tests still pass.',
          true, 'medium'),

        ...(prefs.requiresCoexistence ? [
          step('2.2', 'Add feature flag / toggle',
            'Wrap the old and new implementations behind a feature flag. ' +
            'This allows progressive rollout and instant rollback.',
            undefined,
            undefined,
            'Feature flag works: toggling it switches between old and new code paths.',
            true, 'medium'),
        ] : []),
      ],
    },

    {
      id: 'new-implementation',
      name: 'Phase 3 — New Implementation',
      goal: 'Write the new implementation following the pattern shown in the sample PR.',
      steps: [
        step('3.1', 'Implement the new pattern for the pilot file',
          'Choose **one representative file** from the migration target list. ' +
          'Apply the full migration to it as a reference. ' +
          'This is your "worked example" — the AI agent will reference it for all subsequent files.',
          undefined,
          undefined,
          'Pilot file compiles. Its tests pass. Old tests still pass.',
          false, 'medium'),

        step('3.2', 'Write or update tests for the pilot file',
          'Ensure the pilot file has adequate test coverage under the new pattern before proceeding.',
          undefined,
          undefined,
          'Test coverage for the pilot file is >= previous coverage.',
          false, 'low'),
      ],
    },

    {
      id: 'migration',
      name: 'Phase 4 — File-by-File Migration',
      goal: 'Apply the migration to every target file in dependency order. ' +
        'Migrate leaf nodes (files with no dependents) first, then their parents. ' +
        '**Never remove an export before all its import sites have been updated.**',
      steps: [
        step('4.1', 'Sort files in dependency order',
          'Using your IDE or `madge`/`depcruise`, determine which files depend on which. ' +
          'Build a migration order: migrate files that others depend on LAST, ' +
          'or create adapters so they can be migrated independently.',
          ['npx madge --circular --extensions ts src/'],
          undefined,
          'Dependency graph is understood. No circular dependencies block the order.',
          false, 'none'),

        step('4.2', 'Migrate each file (repeat per file)',
          'For each file in the ordered list:\n\n' +
          '1. Open the file.\n' +
          '2. Apply the migration pattern (use the pilot file as reference).\n' +
          '3. Update all import statements in this file.\n' +
          '4. Run `tsc --noEmit` — fix only errors **in this file**. ' +
          '   Errors in other files will be resolved when those files are migrated.\n' +
          '5. Run the test suite for this file.\n' +
          '6. Commit: `git commit -m "migrate: apply new pattern to <filename>"`',
          undefined,
          undefined,
          'File compiles. Its tests pass. No regressions in already-migrated files.',
          false, 'medium'),

        ...(prefs.testingStrategy === 'unit-first' ? [
          step('4.3', 'Update test file alongside each source file',
            'Migrate the corresponding test file immediately after each source file. ' +
            'Never leave a migrated source file with un-migrated tests.',
            undefined,
            undefined,
            'All tests pass after each file + its test file are migrated.',
            false, 'low'),
        ] : []),
      ],
    },

    {
      id: 'validation',
      name: 'Phase 5 — Validation',
      goal: 'Confirm the entire codebase is correct before removing any old code.',
      steps: [
        step('5.1', 'Full TypeScript / lint check',
          'Run a clean type-check and lint on the entire project. ' +
          'All errors must be fixed before proceeding.',
          ['npx tsc --noEmit', 'npx eslint .'],
          undefined,
          'Zero type errors. Zero lint errors.',
          false, 'none'),

        step('5.2', 'Run full test suite',
          'Run all unit, integration, and E2E tests.',
          undefined,
          undefined,
          'All tests pass. No regressions.',
          false, 'none'),

        step('5.3', 'Smoke test in staging / preview',
          'Deploy to a staging environment and verify the application behaves correctly.',
          undefined,
          undefined,
          'Staging environment is healthy. Key user flows work.',
          false, 'none'),
      ],
    },

    {
      id: 'cleanup',
      name: 'Phase 6 — Cleanup',
      goal: 'Remove all old code, adapters, and dependencies. Only after validation passes.',
      steps: [
        step('6.1', 'Remove compatibility / adapter layer',
          'Delete the adapter wrappers created in Phase 2. ' +
          'All call sites should now use the new API directly.',
          undefined,
          undefined,
          'Project builds and tests still pass after adapter removal.',
          false, 'medium'),

        ...(prefs.requiresCoexistence ? [
          step('6.2', 'Remove feature flag',
            'Delete the feature flag and associated conditional logic. ' +
            'Hardcode the new behaviour.',
            undefined,
            undefined,
            'Feature flag is gone. Only the new code path remains.',
            false, 'medium'),
        ] : []),

        step('6.3', 'Remove old dependencies',
          'Uninstall packages that are no longer needed. ' +
          'Update `package.json` (or equivalent).',
          undefined,
          undefined,
          '`npm ls <old-package>` shows it is no longer installed.',
          false, 'low'),

        step('6.4', 'Delete old type definitions',
          'Remove types, interfaces, and utility functions that were only needed ' +
          'during the transition period.',
          undefined,
          undefined,
          'TypeScript compiles with no errors after deletion.',
          false, 'medium'),
      ],
    },

    {
      id: 'documentation',
      name: 'Phase 7 — Documentation',
      goal: 'Update all documentation to reflect the new approach.',
      steps: [
        step('7.1', 'Update README and contributing guide',
          'Update setup instructions, architecture diagrams, and contributing guidelines.',
          undefined,
          undefined,
          'README accurately describes the new stack.',
          false, 'none'),

        step('7.2', 'Archive migration guide',
          'Move this migration guide to a permanent location (e.g. `docs/migrations/`). ' +
          'Future developers can reference it to understand why the change was made.',
          undefined,
          undefined,
          'Migration guide is committed to the repository.',
          false, 'none'),
      ],
    },
  ].filter(phase => phase.steps.length > 0);
}

// ─── Big bang phases ───────────────────────────────────────────────────────────

function buildBigBangPhases(prefs: Partial<UserMigrationPreferences>): MigrationPhase[] {
  return [
    {
      id: 'preparation',
      name: 'Phase 1 — Preparation',
      goal: 'Set up the migration branch and all dependencies before touching source files.',
      steps: [
        step('1.1', 'Create migration branch',
          'All changes will happen here. Merge only after full validation.',
          ['git checkout -b migration/$(date +%Y%m%d)-big-bang'],
          undefined, 'Branch is created and CI is green.', false, 'none'),

        step('1.2', 'Install new dependencies + remove old ones',
          'In a big-bang migration you can install new and remove old in one go, ' +
          'since there is no transition period.',
          undefined,
          undefined, 'Build succeeds with new deps.', false, 'medium'),

        step('1.3', 'Update all configuration files',
          'Update tsconfig, build tools, CI pipelines, and linting config.',
          undefined,
          undefined, 'Config files are consistent. Build starts.', false, 'medium'),
      ],
    },

    {
      id: 'migration',
      name: 'Phase 2 — Full Codebase Migration',
      goal: 'Migrate all files. Use codemods where possible. Review diff carefully.',
      steps: [
        step('2.1', 'Run automated codemod (if available)',
          'Apply any available codemod first to get the bulk of the changes.',
          undefined,
          undefined, 'Codemod runs without errors. Diff looks sensible.', false, 'high'),

        step('2.2', 'Fix remaining TypeScript errors',
          'After the codemod, run `tsc --noEmit` and fix all errors. ' +
          'Work through them file by file, top to bottom in the error list.',
          ['npx tsc --noEmit 2>&1 | head -100'],
          undefined, 'Zero TypeScript errors.', false, 'high'),

        step('2.3', 'Fix lint errors',
          undefined,
          ['npx eslint . --fix'],
          undefined, 'Zero lint errors.', false, 'low'),
      ],
    },

    {
      id: 'validation',
      name: 'Phase 3 — Validation',
      goal: 'Everything must pass before merge.',
      steps: [
        step('3.1', 'Run full test suite',
          undefined,
          undefined,
          undefined, 'All tests pass.', false, 'none'),

        step('3.2', 'Staging smoke test',
          undefined,
          undefined,
          undefined, 'Application is healthy in staging.', false, 'none'),

        step('3.3', 'Code review',
          'Get a thorough review of the migration diff. ' +
          'Pay particular attention to any manual overrides applied after the codemod.',
          undefined,
          undefined, 'PR is approved by at least one reviewer.', false, 'none'),
      ],
    },

    {
      id: 'documentation',
      name: 'Phase 4 — Documentation',
      goal: 'Update docs to reflect the new approach.',
      steps: [
        step('4.1', 'Update README and architecture docs', undefined, undefined, undefined,
          'Docs are accurate.', false, 'none'),
      ],
    },
  ];
}

// ─── Vertical slice phases ─────────────────────────────────────────────────────

function buildVerticalSlicePhases(prefs: Partial<UserMigrationPreferences>): MigrationPhase[] {
  const scopeDetail = prefs.scopeDetails || 'feature areas (e.g. auth, dashboard, settings)';
  return [
    {
      id: 'preparation',
      name: 'Phase 1 — Preparation',
      goal: 'Install new dependencies, create shared types, and define the slice order.',
      steps: [
        step('1.1', 'Install new dependencies',
          undefined, undefined, undefined, 'Build succeeds.', false, 'low'),

        step('1.2', 'Identify and prioritise slices',
          `List all feature slices to migrate: ${scopeDetail}.\n` +
          'Order them from lowest-risk to highest-risk. ' +
          'Start with a slice that has full test coverage and clear boundaries.',
          undefined, undefined, 'Slice list is agreed by the team.', false, 'none'),

        step('1.3', 'Create shared type definitions',
          undefined, undefined, undefined, 'Types compile.', false, 'low'),
      ],
    },

    {
      id: 'migration',
      name: 'Phase 2 — Slice-by-Slice Migration (repeat per slice)',
      goal: 'Migrate each feature slice fully (UI → logic → data) before moving to the next.',
      steps: [
        step('2.1', 'Identify all files in the slice',
          'Map out every file belonging to this slice: UI components, hooks/services, state, API calls, tests.',
          undefined, undefined, 'File list for the slice is complete.', false, 'none'),

        step('2.2', 'Migrate data / model layer first',
          'Start at the bottom of the stack. Migrate data types, schemas, and repository/service functions.',
          undefined, undefined, 'Data layer compiles and tests pass.', false, 'medium'),

        step('2.3', 'Migrate business logic / services',
          'Migrate hooks, stores, services, and controllers that use the data layer.',
          undefined, undefined, 'Business logic compiles and tests pass.', false, 'medium'),

        step('2.4', 'Migrate UI layer',
          'Migrate components, pages, and views that use the business logic.',
          undefined, undefined, 'UI renders correctly. Component tests pass.', false, 'medium'),

        step('2.5', 'End-to-end test the slice',
          'Run the E2E test suite for the slice (or manually verify the key flows).',
          undefined, undefined, 'All flows in this slice work end-to-end.', false, 'none'),

        step('2.6', 'Commit and merge the slice',
          'Merge the slice migration as a single PR. Tag it clearly.',
          ['git commit -m "migrate(<slice-name>): complete vertical slice migration"'],
          undefined, 'Slice is merged. Main branch is green.', false, 'none'),
      ],
    },

    {
      id: 'cleanup',
      name: 'Phase 3 — Final Cleanup (after all slices)',
      goal: 'Remove remaining old code once all slices are migrated.',
      steps: [
        step('3.1', 'Remove old dependencies',
          undefined, undefined, undefined, 'Old deps are gone. Build succeeds.', false, 'low'),

        step('3.2', 'Remove transition helpers and shared adapters',
          undefined, undefined, undefined, 'No adapter code remains.', false, 'medium'),
      ],
    },

    {
      id: 'documentation',
      name: 'Phase 4 — Documentation',
      goal: '',
      steps: [
        step('4.1', 'Update README and architecture docs',
          undefined, undefined, undefined, 'Docs are up to date.', false, 'none'),
      ],
    },
  ];
}

// ─── Strangler fig phases ──────────────────────────────────────────────────────

function buildStranglerFigPhases(prefs: Partial<UserMigrationPreferences>): MigrationPhase[] {
  return [
    {
      id: 'preparation',
      name: 'Phase 1 — Preparation & Façade',
      goal: 'Install new dependencies and create the strangler façade that routes between old and new.',
      steps: [
        step('1.1', 'Install new dependencies alongside old',
          undefined, undefined, undefined, 'Both old and new deps are installed.', false, 'low'),

        step('1.2', 'Implement the strangler façade',
          'Create a routing layer (API gateway, middleware, or adapter) that intercepts calls ' +
          'and delegates to either the old or new implementation. ' +
          'Initially route 100% to the old implementation.',
          undefined,
          undefined,
          'Façade works. All requests still go to old implementation. Tests pass.',
          false, 'high'),

        step('1.3', 'Implement feature flag / routing rules',
          'Add a mechanism to route specific requests (by user, header, environment, or percentage) ' +
          'to the new implementation.',
          undefined,
          undefined,
          'Routing works. Old code still handles all production traffic.',
          false, 'medium'),
      ],
    },

    {
      id: 'new-implementation',
      name: 'Phase 2 — New Implementation',
      goal: 'Build the new implementation behind the façade while old code serves production.',
      steps: [
        step('2.1', 'Implement new code behind the façade',
          'Write the new implementation. It is shielded from production traffic by the façade, ' +
          'so it is safe to iterate on.',
          undefined,
          undefined,
          'New implementation passes unit tests.',
          false, 'medium'),

        step('2.2', 'Enable new implementation for internal/dev traffic',
          'Route 0–1% of traffic (or internal users) to the new implementation. ' +
          'Monitor logs and metrics.',
          undefined,
          undefined,
          'No errors or regressions for the routed traffic.',
          false, 'medium'),
      ],
    },

    {
      id: 'migration',
      name: 'Phase 3 — Progressive Cutover',
      goal: 'Gradually increase traffic to the new implementation until it handles 100%.',
      steps: [
        step('3.1', 'Canary: 5% → 25% → 50% → 100%',
          'Increase routing to new implementation in stages. ' +
          'Monitor error rates, latency, and business metrics at each stage. ' +
          'Roll back immediately if any metric degrades.',
          undefined,
          undefined,
          'Error rates and latency are equivalent or better at each stage.',
          false, 'high'),

        step('3.2', 'Full cutover',
          'Route 100% of traffic to the new implementation.',
          undefined,
          undefined,
          'All traffic is on new implementation. No errors.',
          false, 'high'),
      ],
    },

    {
      id: 'cleanup',
      name: 'Phase 4 — Cleanup',
      goal: 'Remove the façade and old implementation once the new code is stable.',
      steps: [
        step('4.1', 'Remove old implementation',
          'After a stabilization period (at least 1 sprint), delete the old code.',
          undefined,
          undefined,
          'Old implementation is deleted. Build and tests pass.',
          false, 'medium'),

        step('4.2', 'Remove the strangler façade',
          'Direct calls go straight to the new implementation. No routing layer.',
          undefined,
          undefined,
          'Façade is gone. Application still works.',
          false, 'medium'),

        step('4.3', 'Remove old dependencies',
          undefined, undefined, undefined, 'Old deps are uninstalled.', false, 'low'),
      ],
    },

    {
      id: 'documentation',
      name: 'Phase 5 — Documentation',
      goal: '',
      steps: [
        step('5.1', 'Update README and architecture docs',
          undefined, undefined, undefined, 'Docs are up to date.', false, 'none'),
      ],
    },
  ];
}

// ─── Step factory ─────────────────────────────────────────────────────────────

function step(
  id: string,
  title: string,
  description?: string,
  commands?: string[],
  _codeChanges?: undefined,
  verification?: string,
  idempotent = false,
  risk: MigrationStep['risk'] = 'none'
): MigrationStep {
  return {
    id,
    title,
    description: description ?? '',
    commands,
    verification: verification ?? 'Proceed once this step completes without errors.',
    idempotent,
    risk,
    modifiesReferences: id.startsWith('4'), // Phase 4 is where references change
    deletesCode: id.startsWith('6') || id.startsWith('4.4'), // Phase 6 and step 4.4
  };
}

