/**
 * Per-conversation session state.
 * State is keyed on the VS Code chat session (stable per Copilot chat thread).
 */

import type {
  KitsuneSession,
  MigrationAnalysis,
  PRInfo,
  Question,
  SessionPhase,
  UserMigrationPreferences,
} from '../types.js';
import { selectQuestions, batchQuestions } from '../questions/QuestionCatalog.js';

// ─── Session store ─────────────────────────────────────────────────────────────

/** One session per VS Code chat thread. Key = first message turn id or a UUID. */
const sessions = new Map<string, KitsuneSession>();

let sessionCounter = 0;

export function createSession(id: string): KitsuneSession {
  const session: KitsuneSession = {
    id,
    phase: 'idle',
    questions: [],
    answers: new Map(),
    currentBatchIndex: 0,
    preferences: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): KitsuneSession | undefined {
  return sessions.get(id);
}

export function getOrCreateSession(id: string): KitsuneSession {
  return sessions.get(id) ?? createSession(id);
}

export function clearSession(id: string): void {
  sessions.delete(id);
}

export function generateSessionId(): string {
  return `kitsune-session-${Date.now()}-${++sessionCounter}`;
}

// ─── State transitions ────────────────────────────────────────────────────────

export function setPRInfo(session: KitsuneSession, pr: PRInfo): void {
  session.prInfo = pr;
  session.phase = 'analyzing';
  session.updatedAt = new Date();
}

export function setAnalysis(
  session: KitsuneSession,
  analysis: MigrationAnalysis,
  questionsPerBatch: number
): void {
  session.analysis = analysis;
  session.questions = selectQuestions(analysis, session.preferences);
  session.currentBatchIndex = 0;
  session.phase = 'questioning';
  session.updatedAt = new Date();
}

/**
 * Get the next batch of questions to ask.
 * Returns undefined when all batches have been delivered.
 */
export function getNextQuestionBatch(
  session: KitsuneSession,
  batchSize: number
): { questions: Question[]; batchNumber: number; totalBatches: number } | undefined {
  const allBatches = batchQuestions(session.questions, batchSize);
  if (session.currentBatchIndex >= allBatches.length) { return undefined; }

  const questions = allBatches[session.currentBatchIndex]!;
  const result = {
    questions,
    batchNumber: session.currentBatchIndex + 1,
    totalBatches: allBatches.length,
  };
  return result;
}

export function advanceBatch(session: KitsuneSession): void {
  session.currentBatchIndex++;
  session.updatedAt = new Date();
}

export function recordAnswers(
  session: KitsuneSession,
  answers: Partial<UserMigrationPreferences>
): void {
  session.preferences = { ...session.preferences, ...answers };
  session.updatedAt = new Date();
}

export function setPhase(session: KitsuneSession, phase: SessionPhase): void {
  session.phase = phase;
  session.updatedAt = new Date();
}

export function setOutputPath(session: KitsuneSession, filePath: string): void {
  session.outputPath = filePath;
  session.updatedAt = new Date();
}

/**
 * Check if all required questions have been answered.
 */
export function allRequiredAnswered(session: KitsuneSession): boolean {
  const required = session.questions.filter(q => q.required);
  for (const q of required) {
    if (!q.prefKey) { continue; }
    if (session.preferences[q.prefKey] === undefined) { return false; }
  }
  return true;
}

/**
 * Build session summary for inclusion in a chat response.
 */
export function formatSessionStatus(session: KitsuneSession): string {
  switch (session.phase) {
    case 'idle':
      return '_No active migration session. Provide a PR URL to begin._';
    case 'fetching':
      return '_Fetching PR data…_';
    case 'analyzing':
      return '_Analyzing PR diff…_';
    case 'questioning': {
      const allBatches = batchQuestions(session.questions, 4);
      return `_Collecting preferences (batch ${session.currentBatchIndex + 1} of ${allBatches.length})_`;
    }
    case 'ready-to-generate':
      return '_All questions answered. Type `/generate` to produce the migration guide._';
    case 'generating':
      return '_Generating migration guide…_';
    case 'complete':
      return `_Migration guide generated. Saved to \`${session.outputPath ?? '.kitsune/'}\`_`;
  }
}
