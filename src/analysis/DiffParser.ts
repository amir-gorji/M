/**
 * Extracts structured information from unified diffs and file patches.
 */

import type { ImportChange, APIChange, DependencyChange } from '../types.js';

// ─── Import extraction ────────────────────────────────────────────────────────

const IMPORT_PATTERNS: Array<{ lang: string; re: RegExp }> = [
  // JS/TS: import X from 'y'  |  import { X } from 'y'  |  require('y')
  { lang: 'ts', re: /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g },
  // Python: from x import y  |  import x
  { lang: 'py', re: /(?:from\s+([^\s]+)\s+import|^import\s+([^\s,;]+))/gm },
  // Java/Kotlin: import x.y.Z;
  { lang: 'java', re: /^import\s+([\w.]+);/gm },
  // C#: using X.Y;
  { lang: 'cs', re: /^using\s+([\w.]+);/gm },
  // Go: import "x/y"
  { lang: 'go', re: /["']([^"']+)["']/g },
];

export interface ParsedImportLine {
  module: string;
  added: boolean; // true = +line, false = -line
  file: string;
}

export function extractImportChanges(
  patch: string,
  filePath: string
): ParsedImportLine[] {
  const ext = filePath.split('.').pop() ?? '';
  const pattern = IMPORT_PATTERNS.find(p =>
    ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext) ? p.lang === 'ts' :
    ['py'].includes(ext) ? p.lang === 'py' :
    ['java', 'kt'].includes(ext) ? p.lang === 'java' :
    ['cs'].includes(ext) ? p.lang === 'cs' :
    ['go'].includes(ext) ? p.lang === 'go' : false
  );

  if (!pattern) { return []; }

  const results: ParsedImportLine[] = [];
  const lines = patch.split('\n');

  for (const line of lines) {
    if (!line.startsWith('+') && !line.startsWith('-')) { continue; }
    const added = line.startsWith('+');
    const content = line.slice(1);

    const re = new RegExp(pattern.re.source, pattern.re.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const module = match[1] ?? match[2] ?? '';
      if (module) {
        results.push({ module, added, file: filePath });
      }
    }
  }

  return results;
}

/**
 * Given all import lines from a PR, produce ImportChange records by pairing
 * removed and added modules across the same file or across files.
 */
export function resolveImportChanges(lines: ParsedImportLine[]): ImportChange[] {
  const removed = lines.filter(l => !l.added);
  const added = lines.filter(l => l.added);

  const changes: ImportChange[] = [];

  for (const rem of removed) {
    // Find an added import in the same file that could be its replacement
    const replacement = added.find(
      a => a.file === rem.file && a.module !== rem.module
    );
    if (replacement) {
      const existing = changes.find(
        c => c.oldImport === rem.module && c.newImport === replacement.module
      );
      if (existing) {
        if (!existing.exampleFiles.includes(rem.file)) {
          existing.exampleFiles.push(rem.file);
        }
      } else {
        changes.push({
          oldImport: rem.module,
          newImport: replacement.module,
          exampleFiles: [rem.file],
        });
      }
    }
  }

  return changes;
}

// ─── Dependency file parsing ──────────────────────────────────────────────────

export function parseDependencyChanges(
  patch: string,
  filePath: string
): DependencyChange[] {
  const changes: DependencyChange[] = [];
  const isPackageJson = filePath.endsWith('package.json');
  const isPipfile = filePath.endsWith('Pipfile') || filePath.endsWith('requirements.txt');
  const isPomXml = filePath.endsWith('pom.xml');
  const isCsproj = filePath.endsWith('.csproj');
  const isGoMod = filePath.endsWith('go.mod');

  if (!isPackageJson && !isPipfile && !isPomXml && !isCsproj && !isGoMod) {
    return changes;
  }

  const lines = patch.split('\n');
  for (const line of lines) {
    if (!line.startsWith('+') && !line.startsWith('-')) { continue; }
    const added = line.startsWith('+');
    const content = line.slice(1).trim();

    if (isPackageJson) {
      // "package": "^1.0.0"
      const m = content.match(/^"([^"]+)"\s*:\s*"([^"]+)"/);
      if (m) {
        changes.push({
          name: m[1]!,
          type: added ? 'added' : 'removed',
          newVersion: added ? m[2]! : undefined,
          oldVersion: added ? undefined : m[2]!,
          devDependency: false, // would need section context — simplified
        });
      }
    } else if (isGoMod) {
      // require github.com/pkg/pkg v1.2.3
      const m = content.match(/require\s+([\w./\-@]+)\s+(v[\d.]+)/);
      if (m) {
        changes.push({
          name: m[1]!,
          type: added ? 'added' : 'removed',
          newVersion: added ? m[2]! : undefined,
          oldVersion: added ? undefined : m[2]!,
          devDependency: false,
        });
      }
    }
    // Additional parsers for Maven/Pipfile/csproj can be added here
  }

  return changes;
}

// ─── API change detection ─────────────────────────────────────────────────────

const API_PATTERNS: Array<{
  type: APIChange['type'];
  removed: RegExp;
  added: RegExp;
  description: (match: string) => string;
}> = [
  {
    type: 'renamed',
    removed: /(?:function|const|class|def|func|method)\s+(\w+)/,
    added: /(?:function|const|class|def|func|method)\s+(\w+)/,
    description: (m: string) => `Symbol renamed: ${m}`,
  },
];

/**
 * Light-weight API change extraction from diff lines.
 * Returns renamed/added/removed function or class definitions.
 */
export function extractAPIChanges(patch: string): APIChange[] {
  const changes: APIChange[] = [];

  const removedDefs: string[] = [];
  const addedDefs: string[] = [];

  const defRe = /(?:^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|def|func)\s+)(\w+)/;

  for (const line of patch.split('\n')) {
    const m = defRe.exec(line.slice(1));
    if (!m) { continue; }
    if (line.startsWith('-')) { removedDefs.push(m[1]!); }
    else if (line.startsWith('+')) { addedDefs.push(m[1]!); }
  }

  // Pair up removed → added (possible renames)
  for (const removed of removedDefs) {
    if (!addedDefs.includes(removed)) {
      // removed but not re-added → truly removed, or renamed
      changes.push({
        description: `\`${removed}\` was removed or renamed`,
        type: 'removed',
        oldSignature: removed,
      });
    }
  }

  for (const added of addedDefs) {
    if (!removedDefs.includes(added)) {
      changes.push({
        description: `\`${added}\` was added`,
        type: 'added',
        newSignature: added,
      });
    }
  }

  return changes;
}

// ─── File extension utilities ────────────────────────────────────────────────

export function collectAffectedExtensions(filePaths: string[]): string[] {
  const exts = new Set<string>();
  for (const p of filePaths) {
    const ext = '.' + (p.split('.').pop() ?? '');
    if (ext.length > 1 && !['', '.', '.lock', '.sum'].includes(ext)) {
      exts.add(ext);
    }
  }
  return Array.from(exts).sort();
}
