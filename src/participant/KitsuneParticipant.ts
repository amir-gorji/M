/**
 * Kitsune chat participant handler.
 *
 * Conversation state machine:
 *
 *   idle → fetching → analyzing → questioning → ready-to-generate → generating → complete
 *
 * The session id is derived from the first request's turn id (stable within a thread).
 * State is stored in the extension-level sessions Map and persisted through ChatResult.metadata.
 */

import * as vscode from 'vscode';
import type { KitsuneSession } from '../types.js';
import {
  getOrCreateSession,
  clearSession,
  setPRInfo,
  setAnalysis,
  getNextQuestionBatch,
  advanceBatch,
  recordAnswers,
  setPhase,
  setOutputPath,
  formatSessionStatus,
} from './ConversationSession.js';
import { extractPRUrl, parsePRUrl, fetchPR } from '../pr/PRFetcher.js';
import { analyzePR } from '../analysis/PRAnalyzer.js';
import {
  scanWorkspace,
  formatScanSummary,
} from '../analysis/WorkspaceScanner.js';
import {
  renderQuestions,
  parseAnswers,
} from '../questions/QuestionGenerator.js';
import { generateMigrationGuide } from '../migration/MigrationGenerator.js';

// ─── Session ID resolution ─────────────────────────────────────────────────────

/**
 * Derive a stable session id from the context history or the request itself.
 * In VS Code, context.history[0] gives us the oldest turn in this chat thread.
 */
function resolveSessionId(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
): string {
  // Use metadata from a previous response if available
  for (const h of context.history) {
    if (
      h instanceof vscode.ChatResponseTurn &&
      h.result?.metadata?.['kitsuneSessionId']
    ) {
      return h.result.metadata['kitsuneSessionId'] as string;
    }
  }
  // Fall back to a stable id derived from the first turn
  const firstTurn = context.history[0];
  if (firstTurn instanceof vscode.ChatRequestTurn) {
    return `kitsune-${firstTurn.prompt.slice(0, 20).replace(/\W/g, '')}`;
  }
  return `kitsune-${Date.now()}`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function kitsuneHandler(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  const sessionId = resolveSessionId(request, context);
  const session = getOrCreateSession(sessionId);

  const metadata: Record<string, unknown> = { kitsuneSessionId: sessionId };

  try {
    // ── Command routing ──────────────────────────────────────────────────
    if (request.command === 'reset') {
      clearSession(sessionId);
      stream.markdown(
        '**Kitsune session reset.** Provide a PR/MR URL to start a new migration analysis.\n\n' +
          '**Examples:**\n' +
          '- `https://github.com/org/repo/pull/42`\n' +
          '- `https://dev.azure.com/org/project/_git/repo/pullrequest/123`\n' +
          '- `https://ado.company.com/project/_git/repo/pullrequest/123`\n' +
          '- `https://ado.company.com/tfs/DefaultCollection/project/_git/repo/pullrequest/123`\n' +
          '- `https://gitlab.com/org/repo/-/merge_requests/5`\n' +
          '- `https://bitbucket.org/workspace/repo/pull-requests/99`',
      );
      return { metadata };
    }

    if (request.command === 'scan') {
      await handleScan(session, stream, token);
      return { metadata };
    }

    if (
      request.command === 'generate' ||
      request.prompt.trim().toLowerCase() === '/generate'
    ) {
      await handleGenerate(session, stream, token);
      return { metadata };
    }

    if (request.command === 'analyze') {
      // Treat prompt as the PR URL
      const url = extractPRUrl(request.prompt) ?? request.prompt.trim();
      await handleAnalyze(session, url, stream, token);
      return { metadata };
    }

    // ── Default routing based on session phase ────────────────────────────
    switch (session.phase) {
      case 'idle':
        await handleIdle(session, request.prompt, stream, token);
        break;

      case 'questioning':
        await handleAnswers(session, request.prompt, stream, token);
        break;

      case 'ready-to-generate':
        // User typed something — try to generate, or ask them to /generate
        if (
          request.prompt.toLowerCase().includes('generat') ||
          request.prompt.trim() === ''
        ) {
          await handleGenerate(session, stream, token);
        } else {
          stream.markdown(
            `All questions have been answered. When you're ready, type \`@kitsune /generate\` to produce the migration guide.\n\n` +
              formatSessionStatus(session),
          );
        }
        break;

      case 'complete':
        await handlePostComplete(session, request.prompt, stream, token);
        break;

      default:
        stream.markdown(`_${formatSessionStatus(session)}_`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stream.markdown(
      `**Kitsune encountered an error:**\n\n\`\`\`\n${message}\n\`\`\`\n\n` +
        'Common causes:\n' +
        '- The PR URL is private — add your access token in VS Code Settings under `kitsune.*`\n' +
        '- The PR URL format is not recognised — double-check the URL\n' +
        '- Network error — check your internet connection\n\n' +
        'Type `@kitsune /reset` to start over.',
    );
  }

  return { metadata };
}

// ─── Phase handlers ───────────────────────────────────────────────────────────

async function handleIdle(
  session: KitsuneSession,
  prompt: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const url = extractPRUrl(prompt);
  if (!url) {
    stream.markdown(renderWelcome());
    return;
  }
  await handleAnalyze(session, url, stream, token);
}

async function handleAnalyze(
  session: KitsuneSession,
  url: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const coords = parsePRUrl(url);
  if (!coords) {
    stream.markdown(
      `**Could not parse PR URL**: \`${url}\`\n\n` +
        'Supported formats:\n' +
        '- GitHub: `https://github.com/{owner}/{repo}/pull/{number}`\n' +
        '- GitHub Enterprise: `https://{host}/{owner}/{repo}/pull/{number}`\n' +
        '- Azure DevOps: `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}`\n' +
        '- Azure DevOps (legacy): `https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}`\n' +
        '- Azure DevOps (custom domain): `https://{host}/{project}/_git/{repo}/pullrequest/{id}`\n' +
        '- Azure DevOps Server: `https://{host}/{collection}/{project}/_git/{repo}/pullrequest/{id}`\n' +
        '- GitLab: `https://gitlab.com/{namespace}/{repo}/-/merge_requests/{id}`\n' +
        '- Bitbucket: `https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}`\n' +
        '- Bitbucket Server: `https://{host}/projects/{key}/repos/{repo}/pull-requests/{id}`',
    );
    return;
  }

  // ── Fetch PR ──────────────────────────────────────────────────────────
  stream.markdown(`Fetching PR from **${coords.provider}**…`);
  setPhase(session, 'fetching');

  const pr = await fetchPR(coords);
  setPRInfo(session, pr);

  stream.markdown(
    `\n\n**PR fetched**: [${pr.title}](${coords.url})\n` +
      `- ${pr.files.length} files changed\n` +
      `- ${pr.commits.length} commits\n` +
      `- \`${pr.sourceBranch}\` → \`${pr.targetBranch}\`\n\n` +
      `Analysing the diff…`,
  );

  // ── Analyse ───────────────────────────────────────────────────────────
  const analysis = await analyzePR(pr, token);
  const cfg = vscode.workspace.getConfiguration('kitsune');
  const batchSize = cfg.get<number>('questionsPerBatch') ?? 4;
  setAnalysis(session, analysis, batchSize);

  stream.markdown(
    `\n\n**Analysis complete!**\n\n` +
      `${analysis.summary}\n\n` +
      (analysis.fromTechnology
        ? `**Migration**: ${analysis.fromTechnology} → ${analysis.toTechnology}\n`
        : '') +
      `**Complexity**: ${analysis.complexity}\n` +
      `**Types detected**: ${analysis.migrationTypes
        .map((t) =>
          t
            .split('-')
            .map((w) => w[0]!.toUpperCase() + w.slice(1))
            .join(' '),
        )
        .join(', ')}\n\n` +
      (analysis.importChanges.length > 0
        ? `**Import changes detected**:\n` +
          analysis.importChanges
            .slice(0, 5)
            .map((ic) => `- \`${ic.oldImport}\` → \`${ic.newImport}\``)
            .join('\n') +
          '\n\n'
        : '') +
      '---\n\n' +
      'Now I need to ask you some questions to tailor the migration guide. ' +
      'Reply to the questions below — just number your answers (1., 2., etc.).\n\n',
  );

  // ── Scan workspace in background ──────────────────────────────────────
  if (vscode.workspace.workspaceFolders && analysis.searchPatterns.length > 0) {
    scanWorkspace(analysis.searchPatterns, token)
      .then((scanResult) => {
        analysis.estimatedTargetCount = scanResult.totalTargets;
        session.analysis = analysis;
        // We can't stream here (out of scope), but the info will appear in the guide
      })
      .catch(() => {
        /* workspace scan is best-effort */
      });
  }

  // ── Ask first batch of questions ──────────────────────────────────────
  const batch = getNextQuestionBatch(session, batchSize);
  if (batch) {
    stream.markdown(
      renderQuestions(
        batch.questions,
        batch.batchNumber,
        batch.totalBatches,
        analysis,
      ),
    );
    advanceBatch(session);
  }
}

async function handleAnswers(
  session: KitsuneSession,
  prompt: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  if (!session.analysis) {
    stream.markdown('_No analysis data. Please provide a PR URL first._');
    return;
  }

  const cfg = vscode.workspace.getConfiguration('kitsune');
  const batchSize = cfg.get<number>('questionsPerBatch') ?? 4;

  // Determine which questions were just answered (previous batch)
  const allBatches = (
    await import('../questions/QuestionCatalog.js')
  ).batchQuestions(session.questions, batchSize);
  const prevBatchIdx = session.currentBatchIndex - 1;
  const prevBatch = allBatches[prevBatchIdx] ?? [];

  const parsedPrefs = parseAnswers(prompt, prevBatch, session.preferences);
  recordAnswers(session, parsedPrefs);

  // Ask next batch or proceed to generate
  const nextBatch = getNextQuestionBatch(session, batchSize);
  if (nextBatch) {
    stream.markdown(
      'Got it! Here are the next set of questions:\n\n' +
        renderQuestions(
          nextBatch.questions,
          nextBatch.batchNumber,
          nextBatch.totalBatches,
          session.analysis,
        ),
    );
    advanceBatch(session);
  } else {
    setPhase(session, 'ready-to-generate');
    stream.markdown(
      "**All questions answered!** Here's a summary of your migration configuration:\n\n" +
        formatPreferencesSummary(session.preferences) +
        '\n\n---\n\n' +
        'Type `@kitsune /generate` to produce the migration guide, ' +
        'or continue chatting to refine any answers.',
    );
  }
}

async function handleGenerate(
  session: KitsuneSession,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  if (!session.prInfo || !session.analysis) {
    stream.markdown(
      '_No PR has been analysed yet. Provide a PR URL first._\n\n' +
        'Example: `@kitsune /analyze https://github.com/org/repo/pull/42`',
    );
    return;
  }

  setPhase(session, 'generating');
  stream.markdown('Generating your migration guide…');

  const { markdown, filePath } = await generateMigrationGuide(
    session.prInfo,
    session.analysis,
    session.preferences,
  );

  setOutputPath(session, filePath);
  setPhase(session, 'complete');

  // Show a preview of the guide (first 2000 chars)
  const preview = markdown.slice(0, 2500);
  const truncated = markdown.length > 2500;

  stream.markdown(
    `\n\n**Migration guide generated!**\n\n` +
      `Saved to: \`${filePath}\`\n\n` +
      '---\n\n' +
      '**Preview:**\n\n' +
      preview +
      (truncated
        ? '\n\n_…(truncated — open the file for the full guide)_'
        : '') +
      '\n\n---\n\n' +
      `Open the guide with \`@kitsune\` → \`Open Latest Migration Guide\` ` +
      `or run the VS Code command **Kitsune: Open Latest Migration Guide**.`,
  );

  // Open the file in the editor
  try {
    const uri = vscode.Uri.file(filePath);
    await vscode.commands.executeCommand('markdown.showPreview', uri);
  } catch {
    // Preview may not be available in all contexts
  }
}

async function handleScan(
  session: KitsuneSession,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  if (!session.analysis) {
    stream.markdown(
      '_No migration analysis available. Provide a PR URL first, then run `/scan`._',
    );
    return;
  }

  if (session.analysis.searchPatterns.length === 0) {
    stream.markdown(
      '_No search patterns were detected for this migration. The workspace scan is not applicable._',
    );
    return;
  }

  stream.markdown('Scanning workspace for migration targets…');
  const result = await scanWorkspace(session.analysis.searchPatterns, token);
  session.analysis.estimatedTargetCount = result.totalTargets;

  stream.markdown('\n\n' + formatScanSummary(result));
}

async function handlePostComplete(
  session: KitsuneSession,
  prompt: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  // Re-generate if asked
  if (/regenerat|redo|update/i.test(prompt)) {
    setPhase(session, 'ready-to-generate');
    await handleGenerate(session, stream, token);
    return;
  }
  stream.markdown(
    `The migration guide has been saved to \`${session.outputPath}\`.\n\n` +
      'You can:\n' +
      '- Ask me to regenerate it with different settings\n' +
      '- Run `@kitsune /reset` to start a new migration\n' +
      '- Run `@kitsune /scan` to count migration targets in your workspace',
  );
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function renderWelcome(): string {
  return [
    '## Kitsune Migration Agent',
    '',
    'I analyse a sample Pull Request to understand what migration it demonstrates, ' +
      'then generate a comprehensive, AI-ready migration playbook for your entire codebase.',
    '',
    '**To get started**, paste a PR/MR URL:',
    '',
    '```',
    '# GitHub',
    'https://github.com/org/repo/pull/42',
    '',
    '# GitHub Enterprise',
    'https://git.company.com/org/repo/pull/42',
    '',
    '# Azure DevOps',
    'https://dev.azure.com/org/project/_git/repo/pullrequest/123',
    '',
    '# Azure DevOps Custom Domain',
    'https://ado.company.com/project/_git/repo/pullrequest/123',
    '',
    '# Azure DevOps Server',
    'https://ado.company.com/tfs/DefaultCollection/project/_git/repo/pullrequest/123',
    '',
    '# GitLab',
    'https://gitlab.com/org/repo/-/merge_requests/5',
    '',
    '# Bitbucket Cloud',
    'https://bitbucket.org/workspace/repo/pull-requests/99',
    '',
    '# Bitbucket Server',
    'https://bitbucket.company.com/projects/KEY/repos/repo/pull-requests/1',
    '```',
    '',
    '**For private repositories**, configure your access token in VS Code Settings:',
    '`kitsune.github.token`, `kitsune.azureDevOps.token`, `kitsune.gitlab.token`, etc.',
    '',
    '**Commands:**',
    '- `/analyze <url>` — Analyse a PR',
    '- `/generate` — Generate the migration guide now',
    '- `/scan` — Count migration targets in this workspace',
    '- `/reset` — Start a new session',
  ].join('\n');
}

function formatPreferencesSummary(
  prefs: Partial<import('../types.js').UserMigrationPreferences>,
): string {
  const rows: string[] = [
    `| Setting | Value |`,
    `|---|---|`,
    `| Approach | ${prefs.approach ?? '_not set_'} |`,
    `| Scope | ${prefs.scope ?? '_not set_'} |`,
    `| Testing strategy | ${prefs.testingStrategy ?? '_not set_'} |`,
    `| Team size | ${prefs.teamSize ?? '_not set_'} |`,
    `| Timeline | ${prefs.timeline ?? '_not set_'} |`,
    `| Requires coexistence | ${prefs.requiresCoexistence ?? '_not set_'} |`,
    `| Requires source review | ${prefs.requiresSourceReview ?? '_not set_'} |`,
    `| Breaking for consumers | ${prefs.isBreakingForConsumers ?? '_not set_'} |`,
  ];
  return rows.join('\n');
}
