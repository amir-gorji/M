/**
 * Renders questions into markdown and parses user answers back into preferences.
 */

import type { MigrationAnalysis, MigrationApproach, Question, TeamSize, TestingStrategy, UserMigrationPreferences } from '../types.js';

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Render a batch of questions as a single markdown message.
 */
export function renderQuestions(
  questions: Question[],
  batchNumber: number,
  totalBatches: number,
  analysis: MigrationAnalysis
): string {
  const progress = totalBatches > 1
    ? `\n\n_Questions ${batchNumber} of ${totalBatches}_\n\n---\n\n`
    : '\n\n';

  const rendered = questions.map((q, i) => {
    const text = typeof (q as unknown as { text: (a: MigrationAnalysis) => string }).text === 'function'
      ? (q as unknown as { text: (a: MigrationAnalysis) => string }).text(analysis)
      : q.text;

    const prefix = `### ${batchNumber > 1 ? (batchNumber - 1) * 4 + i + 1 : i + 1}. ${text}`;

    if (q.type === 'multiple-choice' || q.type === 'yes-no') {
      return prefix; // Options are already embedded in the question text
    }
    return prefix + '\n\n_Type your answer below._';
  }).join('\n\n---\n\n');

  const suffix = '\n\n---\n\n' +
    '_Reply with your answers (numbered to match the questions above). ' +
    'Type `/generate` when you\'re done and want me to produce the migration guide immediately._';

  return progress + rendered + suffix;
}

// ─── Answer parsing ───────────────────────────────────────────────────────────

/**
 * Parse the user's freeform reply and map answers to preferences.
 * This is intentionally lenient — users type naturally, not in strict format.
 */
export function parseAnswers(
  reply: string,
  questions: Question[],
  existing: Partial<UserMigrationPreferences>
): Partial<UserMigrationPreferences> {
  const prefs: Partial<UserMigrationPreferences> = { ...existing };

  // Split by numbered answers: "1. ..." or "1) ..."
  const answerBlocks = splitByNumbers(reply, questions.length);

  questions.forEach((q, i) => {
    const answer = (answerBlocks[i] ?? reply).trim();
    if (!answer || !q.prefKey) { return; }

    switch (q.id) {
      case 'q_analysis_correct':
        prefs.analysisConfirmed = isAffirmative(answer);
        prefs.analysisNotes = answer;
        break;

      case 'q_scope':
        prefs.scope = parseScope(answer);
        break;

      case 'q_scope_details':
        prefs.scopeDetails = answer;
        break;

      case 'q_excluded_paths':
        prefs.excludedPaths = answer.split(/[\n,;]/).map(s => s.trim()).filter(Boolean);
        break;

      case 'q_approach':
        prefs.approach = parseApproach(answer);
        break;

      case 'q_coexistence':
        prefs.requiresCoexistence = isAffirmative(answer);
        break;

      case 'q_coexistence_strategy':
        prefs.coexistenceStrategy = answer;
        break;

      case 'q_breaking_change':
        prefs.isBreakingForConsumers = isAffirmative(answer);
        break;

      case 'q_source_review':
        prefs.requiresSourceReview = answer.toLowerCase().includes('manual');
        break;

      case 'q_testing_strategy':
        prefs.testingStrategy = parseTestingStrategy(answer);
        break;

      case 'q_rollback':
        prefs.rollbackStrategy = answer;
        break;

      case 'q_known_pitfalls':
        prefs.knownPitfalls = answer.split(/\n/).map(s => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
        break;

      case 'q_team_size':
        prefs.teamSize = parseTeamSize(answer);
        break;

      case 'q_timeline':
        prefs.timeline = parseTimeline(answer);
        break;

      case 'q_additional_notes':
        prefs.additionalNotes = answer;
        break;
    }
  });

  return prefs;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function splitByNumbers(text: string, count: number): string[] {
  const results: string[] = [];
  // Try numbered patterns: "1.", "1)", "#1", "Q1"
  const re = /(?:^|\n)(?:#?\d+[.):]?\s*)/gm;
  const parts = text.split(re).filter(Boolean);

  if (parts.length >= count) {
    return parts.slice(0, count);
  }

  // Fallback: use entire text for first question, empty for rest
  results.push(text);
  for (let i = 1; i < count; i++) { results.push(''); }
  return results;
}

function isAffirmative(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.startsWith('a)') ||
    lower.startsWith('yes') ||
    lower.includes('correct') ||
    lower.includes('right') ||
    lower.includes('manual review') ||
    (!lower.includes('no') && !lower.includes('b)'));
}

function parseScope(text: string): UserMigrationPreferences['scope'] {
  const lower = text.toLowerCase();
  if (lower.startsWith('c') || lower.includes('feature')) { return 'feature-areas'; }
  if (lower.startsWith('b') || lower.includes('module') || lower.includes('specific')) { return 'specific-modules'; }
  return 'all';
}

function parseApproach(text: string): MigrationApproach {
  const lower = text.toLowerCase();
  if (lower.startsWith('b') || lower.includes('big bang') || lower.includes('all at once')) { return 'big-bang'; }
  if (lower.startsWith('c') || lower.includes('vertical') || lower.includes('slice')) { return 'vertical-slice'; }
  if (lower.startsWith('d') || lower.includes('strangler') || lower.includes('gradual')) { return 'strangler-fig'; }
  return 'step-by-step';
}

function parseTestingStrategy(text: string): TestingStrategy {
  const lower = text.toLowerCase();
  if (lower.startsWith('b') || lower.includes('integration')) { return 'integration-first'; }
  if (lower.startsWith('c') || lower.includes('parallel')) { return 'parallel'; }
  if (lower.startsWith('d') || lower.includes('e2e')) { return 'e2e-gated'; }
  return 'unit-first';
}

function parseTeamSize(text: string): TeamSize {
  const lower = text.toLowerCase();
  if (lower.startsWith('c') || lower.includes('large') || lower.includes('6')) { return 'large'; }
  if (lower.startsWith('b') || lower.includes('small') || lower.includes('2') || lower.includes('team')) { return 'small'; }
  return 'solo';
}

function parseTimeline(text: string): UserMigrationPreferences['timeline'] {
  const lower = text.toLowerCase();
  if (lower.startsWith('c') || lower.includes('long') || lower.includes('month')) { return 'long-term'; }
  if (lower.startsWith('b') || lower.includes('gradual') || lower.includes('week')) { return 'gradual'; }
  return 'immediate';
}
