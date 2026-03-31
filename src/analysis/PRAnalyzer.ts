/**
 * Orchestrates PR analysis: diff parsing, pattern detection, and LM-based insight.
 * Returns a MigrationAnalysis that drives the questionnaire and guide generation.
 */

import * as vscode from 'vscode';
import type { MigrationAnalysis, PRInfo, SearchPattern } from '../types.js';
import {
  extractImportChanges,
  resolveImportChanges,
  parseDependencyChanges,
  extractAPIChanges,
  collectAffectedExtensions,
} from './DiffParser.js';
import { detectPatterns } from './PatternDetector.js';

export async function analyzePR(
  pr: PRInfo,
  token: vscode.CancellationToken
): Promise<MigrationAnalysis> {
  // ── 1. Run structural analysis ────────────────────────────────────────────
  const allImportLines = pr.files.flatMap(f =>
    extractImportChanges(f.patch ?? '', f.path)
  );
  const importChanges = resolveImportChanges(allImportLines);

  const dependencyChanges = pr.files.flatMap(f =>
    parseDependencyChanges(f.patch ?? '', f.path)
  );

  const apiChanges = extractAPIChanges(pr.fullDiff);

  const configChanges = pr.files
    .filter(f => isConfigFile(f.path))
    .map(f => ({
      file: f.path,
      description: `Configuration file ${f.status}: ${f.path}`,
    }));

  const fileChanges = pr.files
    .filter(f => f.status === 'added' || f.status === 'removed' || f.status === 'renamed')
    .map(f => ({
      type: f.status as 'added' | 'removed' | 'moved' | 'renamed',
      oldPath: f.oldPath,
      newPath: f.path,
      significance: classifyFileSignificance(f.path),
    }));

  const affectedExtensions = collectAffectedExtensions(pr.files.map(f => f.path));

  // ── 2. Pattern detection ──────────────────────────────────────────────────
  const detectedPatterns = detectPatterns(pr.files, pr.fullDiff);
  const primaryPattern = detectedPatterns[0];

  const migrationTypes = detectedPatterns.length > 0
    ? detectedPatterns.map(p => p.type)
    : ['unknown' as const];

  // Collect search patterns from all detected patterns
  const searchPatterns: SearchPattern[] = [];
  const seenSearchPatterns = new Set<string>();
  for (const pattern of detectedPatterns) {
    for (const sp of pattern.searchPatterns) {
      const key = `${sp.regex}:${sp.fileGlob}`;
      if (!seenSearchPatterns.has(key)) {
        searchPatterns.push(sp);
        seenSearchPatterns.add(key);
      }
    }
  }

  // ── 3. LM-based deep analysis (if Copilot available) ──────────────────────
  let llmSummary = '';
  let fromTech = primaryPattern?.from;
  let toTech = primaryPattern?.to;
  let complexity: MigrationAnalysis['complexity'] = estimateComplexity(pr);
  let isBreaking = false;
  let requiresCoexistence = false;
  let requiresSourceReview = false;

  try {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length > 0 && !token.isCancellationRequested) {
      const model = models[0]!;
      const prompt = buildAnalysisPrompt(pr);
      const messages = [
        vscode.LanguageModelChatMessage.User(prompt),
      ];

      const response = await model.sendRequest(messages, {}, token);
      let raw = '';
      for await (const chunk of response.text) {
        raw += chunk;
      }

      const parsed = tryParseJSON<{
        summary?: string;
        from?: string;
        to?: string;
        complexity?: string;
        isBreaking?: boolean;
        requiresCoexistence?: boolean;
        requiresSourceReview?: boolean;
      }>(raw);

      if (parsed) {
        llmSummary = parsed.summary ?? llmSummary;
        fromTech = parsed.from ?? fromTech;
        toTech = parsed.to ?? toTech;
        if (parsed.complexity === 'low' || parsed.complexity === 'medium' || parsed.complexity === 'high') {
          complexity = parsed.complexity;
        }
        isBreaking = parsed.isBreaking ?? isBreaking;
        requiresCoexistence = parsed.requiresCoexistence ?? requiresCoexistence;
        requiresSourceReview = parsed.requiresSourceReview ?? requiresSourceReview;
      } else {
        // Use raw text as summary if JSON parse fails
        llmSummary = raw.slice(0, 500);
      }
    }
  } catch {
    // LM unavailable — fall back to structural analysis only
  }

  const summary = llmSummary || buildFallbackSummary(pr, detectedPatterns, primaryPattern);

  // Example files: pick non-test, non-config source files that changed
  const exampleFiles = pr.files
    .filter(f => f.status === 'modified' && !isTestFile(f.path) && !isConfigFile(f.path))
    .slice(0, 3)
    .map(f => f.path);

  return {
    migrationTypes,
    summary,
    fromTechnology: fromTech,
    toTechnology: toTech,
    importChanges,
    apiChanges,
    fileChanges,
    configChanges,
    dependencyChanges,
    affectedExtensions,
    searchPatterns,
    complexity,
    requiresSourceReview,
    requiresCoexistence,
    isBreakingChange: isBreaking,
    exampleFiles,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildAnalysisPrompt(pr: PRInfo): string {
  const fileList = pr.files.slice(0, 20).map(f =>
    `${f.status.toUpperCase()}: ${f.path} (+${f.additions}/-${f.deletions})`
  ).join('\n');

  const diffPreview = pr.fullDiff.slice(0, 3000);

  return `You are analyzing a pull request to understand what migration it demonstrates.

PR Title: ${pr.title}
PR Description: ${pr.description.slice(0, 500)}
Branch: ${pr.sourceBranch} → ${pr.targetBranch}
Files changed (${pr.files.length} total):
${fileList}

Diff excerpt:
\`\`\`diff
${diffPreview}
\`\`\`

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "summary": "2-3 sentence plain English description of what this migration does",
  "from": "technology/library/pattern being replaced",
  "to": "technology/library/pattern being introduced",
  "complexity": "low|medium|high",
  "isBreaking": true|false,
  "requiresCoexistence": true|false,
  "requiresSourceReview": true|false
}

Guidelines:
- "requiresCoexistence" = old and new code must work simultaneously during migration
- "requiresSourceReview" = each file needs manual inspection, not just find-replace
- "isBreaking" = external consumers of this code are affected`;
}

function buildFallbackSummary(
  pr: PRInfo,
  patterns: ReturnType<typeof detectPatterns>,
  primary: ReturnType<typeof detectPatterns>[0] | undefined
): string {
  if (primary) {
    return `This PR demonstrates a migration from **${primary.from}** to **${primary.to}**. ` +
      `It changes ${pr.files.length} file(s) across the codebase. ` +
      `Evidence: ${primary.evidence.slice(0, 3).join(', ')}.`;
  }
  return `This PR changes ${pr.files.length} file(s) and appears to refactor code across ` +
    pr.files.map(f => f.path.split('.').pop()).filter(Boolean).slice(0, 3).join(', ') + ' files.';
}

function estimateComplexity(pr: PRInfo): MigrationAnalysis['complexity'] {
  const totalChanges = pr.files.reduce((s, f) => s + f.additions + f.deletions, 0);
  if (pr.files.length > 20 || totalChanges > 500) { return 'high'; }
  if (pr.files.length > 5 || totalChanges > 100) { return 'medium'; }
  return 'low';
}

function isConfigFile(path: string): boolean {
  return /\.(config|rc|json|yaml|yml|toml|ini)\b/.test(path) ||
    /(?:webpack|vite|tsconfig|jest|vitest|babel|eslint|prettier|rollup)/.test(path);
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(path) || /__tests__\//.test(path);
}

function classifyFileSignificance(
  path: string
): 'structural' | 'implementation' | 'config' | 'test' | 'docs' {
  if (isTestFile(path)) { return 'test'; }
  if (isConfigFile(path)) { return 'config'; }
  if (/\.(md|mdx|rst|txt)$/.test(path)) { return 'docs'; }
  if (/\/(components?|pages?|screens?|views?|layouts?)\//.test(path)) { return 'structural'; }
  return 'implementation';
}

function tryParseJSON<T>(text: string): T | null {
  // Strip markdown code fences if present
  const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  // Find the first { ... } block
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) { return null; }
  try {
    return JSON.parse(clean.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
