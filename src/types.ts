/**
 * Shared types for the Kitsune Migration Agent.
 */

// ─── Provider & PR types ────────────────────────────────────────────────────

export type PRProvider =
  | 'github'
  | 'github-enterprise'
  | 'azure-devops'
  | 'gitlab'
  | 'bitbucket'
  | 'bitbucket-server';

export interface PRCoordinates {
  provider: PRProvider;
  url: string;
  /** Canonical API base (e.g. https://api.github.com or https://dev.azure.com/org) */
  apiBase: string;
  owner?: string;   // GitHub owner / ADO org / GitLab namespace
  project?: string; // ADO project / GitLab group
  repo: string;
  prId: string;
}

export interface PRFile {
  path: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied';
  oldPath?: string;
  additions: number;
  deletions: number;
  /** Unified diff patch for this file */
  patch?: string;
}

export interface PRCommit {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
}

export interface PRInfo {
  coordinates: PRCoordinates;
  title: string;
  description: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  state: string;
  files: PRFile[];
  commits: PRCommit[];
  /** Full combined diff (all patches concatenated) */
  fullDiff: string;
  createdAt: string;
}

// ─── Analysis types ─────────────────────────────────────────────────────────

export type MigrationType =
  | 'dependency-update'
  | 'framework-migration'
  | 'library-replacement'
  | 'api-redesign'
  | 'language-migration'
  | 'architectural-change'
  | 'pattern-refactor'
  | 'configuration-update'
  | 'test-migration'
  | 'tooling-change'
  | 'unknown';

export interface ImportChange {
  oldImport: string;
  newImport: string;
  /** Representative files where this was detected */
  exampleFiles: string[];
}

export interface APIChange {
  description: string;
  type: 'renamed' | 'signature-changed' | 'removed' | 'added' | 'moved';
  oldSignature?: string;
  newSignature?: string;
}

export interface FileChange {
  type: 'added' | 'removed' | 'moved' | 'renamed';
  oldPath?: string;
  newPath: string;
  significance: 'structural' | 'implementation' | 'config' | 'test' | 'docs';
}

export interface ConfigChange {
  file: string;
  description: string;
  example?: string;
}

export interface DependencyChange {
  name: string;
  type: 'added' | 'removed' | 'upgraded' | 'downgraded';
  oldVersion?: string;
  newVersion?: string;
  devDependency: boolean;
}

export interface MigrationAnalysis {
  migrationTypes: MigrationType[];
  /** Human-readable summary of what the PR demonstrates */
  summary: string;
  /** Technology being migrated FROM */
  fromTechnology?: string;
  /** Technology being migrated TO */
  toTechnology?: string;
  importChanges: ImportChange[];
  apiChanges: APIChange[];
  fileChanges: FileChange[];
  configChanges: ConfigChange[];
  dependencyChanges: DependencyChange[];
  /** File extensions involved (e.g. ['.ts', '.tsx']) */
  affectedExtensions: string[];
  /** Regex/glob patterns to find migration targets in the workspace */
  searchPatterns: SearchPattern[];
  complexity: 'low' | 'medium' | 'high';
  requiresSourceReview: boolean;
  /** Whether old and new code must coexist temporarily */
  requiresCoexistence: boolean;
  /** Whether the migration touches public API surfaces */
  isBreakingChange: boolean;
  /** Files that appear to be templates/examples for the migration */
  exampleFiles: string[];
  /** Estimated number of workspace files needing migration (from scan) */
  estimatedTargetCount?: number;
}

export interface SearchPattern {
  description: string;
  /** grep-compatible regex */
  regex: string;
  /** Glob to scope the search */
  fileGlob: string;
}

// ─── Question & Questionnaire types ─────────────────────────────────────────

export type QuestionCategory =
  | 'validation'
  | 'scope'
  | 'approach'
  | 'constraints'
  | 'team'
  | 'technical'
  | 'risk';

export interface Question {
  id: string;
  category: QuestionCategory;
  text: string;
  type: 'multiple-choice' | 'open-ended' | 'yes-no' | 'ranking';
  options?: string[];
  /** Key into UserMigrationPreferences */
  prefKey?: keyof UserMigrationPreferences;
  /** Whether this question is required */
  required: boolean;
  /** Only ask if this condition is met */
  condition?: (analysis: MigrationAnalysis, prefs: Partial<UserMigrationPreferences>) => boolean;
}

export interface AnsweredQuestion extends Question {
  answer: string;
}

export interface QuestionBatch {
  questions: Question[];
  batchNumber: number;
  totalBatches: number;
}

// ─── User preferences (collected via questionnaire) ──────────────────────────

export type MigrationApproach =
  | 'step-by-step'    // One file at a time, safe and incremental
  | 'big-bang'        // All at once
  | 'vertical-slice'  // Feature by feature, full stack
  | 'strangler-fig';  // Parallel operation, gradual replacement

export type TestingStrategy =
  | 'unit-first'        // Write/update unit tests before migrating each file
  | 'integration-first' // Focus on integration tests
  | 'parallel'          // Run old and new tests simultaneously
  | 'e2e-gated';        // Gate each phase on E2E test passing

export type TeamSize = 'solo' | 'small' | 'large';
export type MigrationTimeline = 'immediate' | 'gradual' | 'long-term';

export interface UserMigrationPreferences {
  /** Did the user confirm that the analysis is correct? */
  analysisConfirmed: boolean;
  /** Corrections or additions to the analysis */
  analysisNotes: string;
  approach: MigrationApproach;
  /** Rationale for why this approach was chosen */
  approachRationale: string;
  scope: 'all' | 'specific-modules' | 'feature-areas';
  scopeDetails: string;
  /** Paths/globs to exclude from migration */
  excludedPaths: string[];
  /** Whether old and new code need to coexist (feature flags, parallel deploy) */
  requiresCoexistence: boolean;
  coexistenceStrategy: string;
  testingStrategy: TestingStrategy;
  /** Whether public APIs / external consumers are affected */
  isBreakingForConsumers: boolean;
  /** Whether source code needs to be re-reviewed during migration */
  requiresSourceReview: boolean;
  rollbackStrategy: string;
  teamSize: TeamSize;
  timeline: MigrationTimeline;
  /** Custom technical notes from the developer */
  additionalNotes: string;
  /** Specific pitfalls the developer knows about */
  knownPitfalls: string[];
}

// ─── Conversation session state ──────────────────────────────────────────────

export type SessionPhase =
  | 'idle'
  | 'fetching'
  | 'analyzing'
  | 'questioning'
  | 'ready-to-generate'
  | 'generating'
  | 'complete';

export interface KitsuneSession {
  id: string;
  phase: SessionPhase;
  prInfo?: PRInfo;
  analysis?: MigrationAnalysis;
  questions: Question[];
  answers: Map<string, string>;
  currentBatchIndex: number;
  preferences: Partial<UserMigrationPreferences>;
  /** Path to generated migration guide */
  outputPath?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Migration document types ─────────────────────────────────────────────────

export interface MigrationStep {
  /** Unique step identifier (e.g. "1.2") */
  id: string;
  title: string;
  description: string;
  /** Shell commands to run */
  commands?: string[];
  /** Code changes with before/after */
  codeChanges?: CodeChange[];
  /** How to verify this step succeeded */
  verification: string;
  /** Steps that must complete before this one */
  dependsOn?: string[];
  /** Whether the AI agent should skip this step if already done */
  idempotent: boolean;
  /** Risk level of this step */
  risk: 'none' | 'low' | 'medium' | 'high';
  /** Whether this step modifies file references */
  modifiesReferences: boolean;
  /** Whether this step deletes/removes anything */
  deletesCode: boolean;
}

export interface CodeChange {
  file?: string;
  description: string;
  before?: string;
  after?: string;
  language?: string;
}

export interface MigrationPhase {
  id: string;
  name: string;
  goal: string;
  steps: MigrationStep[];
}

export interface MigrationDocument {
  title: string;
  prUrl: string;
  approach: MigrationApproach;
  generatedAt: Date;
  analysis: MigrationAnalysis;
  preferences: Partial<UserMigrationPreferences>;
  phases: MigrationPhase[];
  searchPatterns: SearchPattern[];
  automationScript: string;
  commonPitfalls: Pitfall[];
  rollbackPlan: string[];
  validationChecklist: string[];
}

export interface Pitfall {
  name: string;
  description: string;
  avoidance: string;
}
