/**
 * Scans the VS Code workspace for files that match migration search patterns.
 */

import * as vscode from 'vscode';
import type { SearchPattern } from '../types.js';

export interface ScanResult {
  pattern: SearchPattern;
  matchingFiles: string[];
  count: number;
}

export interface WorkspaceScanSummary {
  totalTargets: number;
  results: ScanResult[];
  scannedAt: Date;
}

/**
 * Scan the workspace for all migration targets based on the provided patterns.
 * Returns file paths relative to the workspace root.
 */
export async function scanWorkspace(
  patterns: SearchPattern[],
  token?: vscode.CancellationToken
): Promise<WorkspaceScanSummary> {
  const results: ScanResult[] = [];
  const seenFiles = new Set<string>();

  for (const pattern of patterns) {
    if (token?.isCancellationRequested) { break; }

    const matchingFiles: string[] = [];

    if (pattern.fileGlob && !pattern.regex) {
      // Pure file glob search (e.g. find webpack.config files)
      const uris = await vscode.workspace.findFiles(
        pattern.fileGlob,
        '**/node_modules/**',
        500
      );
      for (const uri of uris) {
        const rel = vscode.workspace.asRelativePath(uri);
        matchingFiles.push(rel);
        seenFiles.add(rel);
      }
    } else if (pattern.regex) {
      // Content search via VS Code search API
      const uris = await vscode.workspace.findFiles(
        pattern.fileGlob || '**/*',
        '**/node_modules/**',
        1000
      );

      const re = new RegExp(pattern.regex);

      // Process files in batches to avoid blocking
      const BATCH = 50;
      for (let i = 0; i < uris.length; i += BATCH) {
        if (token?.isCancellationRequested) { break; }
        const batch = uris.slice(i, i + BATCH);
        await Promise.all(batch.map(async uri => {
          try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const content = Buffer.from(bytes).toString('utf-8');
            if (re.test(content)) {
              const rel = vscode.workspace.asRelativePath(uri);
              if (!seenFiles.has(rel)) {
                matchingFiles.push(rel);
                seenFiles.add(rel);
              }
            }
          } catch {
            // File unreadable — skip silently
          }
        }));
      }
    }

    results.push({ pattern, matchingFiles, count: matchingFiles.length });
  }

  return {
    totalTargets: seenFiles.size,
    results,
    scannedAt: new Date(),
  };
}

/**
 * Format a scan summary as a markdown snippet for inclusion in the chat response.
 */
export function formatScanSummary(summary: WorkspaceScanSummary): string {
  if (summary.totalTargets === 0) {
    return '> No migration targets found in the current workspace.';
  }

  const lines = [
    `**Workspace scan** found **${summary.totalTargets}** file(s) requiring migration:\n`,
  ];

  for (const r of summary.results) {
    if (r.count === 0) { continue; }
    lines.push(`- **${r.pattern.description}**: ${r.count} file(s)`);
    // Show up to 5 example files
    for (const f of r.matchingFiles.slice(0, 5)) {
      lines.push(`  - \`${f}\``);
    }
    if (r.matchingFiles.length > 5) {
      lines.push(`  - _…and ${r.matchingFiles.length - 5} more_`);
    }
  }

  return lines.join('\n');
}
