/**
 * Detects known migration patterns from PR data.
 * Covers frameworks, libraries, languages, and architectural patterns.
 */

import type { MigrationType, PRFile, SearchPattern } from '../types.js';

export interface DetectedPattern {
  type: MigrationType;
  confidence: 'high' | 'medium' | 'low';
  from: string;
  to: string;
  evidence: string[];
  searchPatterns: SearchPattern[];
}

// ─── Pattern catalogue ────────────────────────────────────────────────────────

interface PatternRule {
  name: string;
  type: MigrationType;
  from: string;
  to: string;
  /** Strings that must appear in removed lines */
  removedSignals: string[];
  /** Strings that must appear in added lines */
  addedSignals: string[];
  /** File name signals (any of these in any changed file name) */
  fileSignals?: string[];
  searchPatterns: SearchPattern[];
}

const PATTERN_RULES: PatternRule[] = [
  // ── React 17 → 18 ──────────────────────────────────────────────────────────
  {
    name: 'React 17 → 18',
    type: 'framework-migration',
    from: 'React 17',
    to: 'React 18',
    removedSignals: ['ReactDOM.render(', 'import ReactDOM from'],
    addedSignals: ['createRoot(', 'root.render('],
    searchPatterns: [
      { description: 'Files using ReactDOM.render', regex: 'ReactDOM\\.render\\(', fileGlob: '**/*.{ts,tsx,js,jsx}' },
    ],
  },

  // ── Redux → Redux Toolkit ───────────────────────────────────────────────────
  {
    name: 'Redux → Redux Toolkit',
    type: 'library-replacement',
    from: 'Redux (vanilla)',
    to: 'Redux Toolkit',
    removedSignals: ['createStore(', 'combineReducers(', "from 'redux'"],
    addedSignals: ['configureStore(', 'createSlice(', "from '@reduxjs/toolkit'"],
    searchPatterns: [
      { description: 'Files using vanilla Redux createStore', regex: 'createStore\\(', fileGlob: '**/*.{ts,tsx,js,jsx}' },
      { description: "Files importing from 'redux'", regex: "from ['\"]redux['\"]", fileGlob: '**/*.{ts,tsx,js,jsx}' },
    ],
  },

  // ── Class components → Hooks ────────────────────────────────────────────────
  {
    name: 'React Class Components → Hooks',
    type: 'pattern-refactor',
    from: 'React Class Components',
    to: 'React Functional Components with Hooks',
    removedSignals: ['extends Component', 'extends PureComponent', 'this.setState(', 'componentDidMount'],
    addedSignals: ['useState(', 'useEffect(', 'useCallback(', 'useMemo('],
    searchPatterns: [
      { description: 'Class components', regex: 'extends (Pure)?Component', fileGlob: '**/*.{ts,tsx,js,jsx}' },
      { description: 'componentDidMount usage', regex: 'componentDidMount', fileGlob: '**/*.{ts,tsx,js,jsx}' },
    ],
  },

  // ── Vue 2 → Vue 3 ──────────────────────────────────────────────────────────
  {
    name: 'Vue 2 → Vue 3',
    type: 'framework-migration',
    from: 'Vue 2',
    to: 'Vue 3',
    removedSignals: ["from 'vue'", 'new Vue(', 'Vue.extend('],
    addedSignals: ['defineComponent(', 'setup()', 'ref(', 'reactive(', 'createApp('],
    searchPatterns: [
      { description: 'Vue 2 new Vue() instantiation', regex: 'new Vue\\(', fileGlob: '**/*.{ts,js,vue}' },
      { description: 'Vue 2 Options API components', regex: 'Vue\\.extend\\(', fileGlob: '**/*.{ts,js,vue}' },
    ],
  },

  // ── Angular.js → Angular ───────────────────────────────────────────────────
  {
    name: 'AngularJS → Angular',
    type: 'framework-migration',
    from: 'AngularJS (1.x)',
    to: 'Angular (2+)',
    removedSignals: ['angular.module(', '$scope', '$http', 'ng-controller'],
    addedSignals: ['@Component(', '@NgModule(', '@Injectable(', 'ngOnInit'],
    searchPatterns: [
      { description: 'AngularJS module definitions', regex: 'angular\\.module\\(', fileGlob: '**/*.{ts,js,html}' },
    ],
  },

  // ── CommonJS → ESM ─────────────────────────────────────────────────────────
  {
    name: 'CommonJS → ES Modules',
    type: 'language-migration',
    from: 'CommonJS (require)',
    to: 'ES Modules (import/export)',
    removedSignals: ['require(', 'module.exports', 'exports.'],
    addedSignals: ['import ', 'export default', 'export {', 'export const'],
    searchPatterns: [
      { description: 'CommonJS require calls', regex: "require\\(['\"]", fileGlob: '**/*.{ts,js,mjs}' },
      { description: 'module.exports assignments', regex: 'module\\.exports', fileGlob: '**/*.{js,cjs}' },
    ],
  },

  // ── JavaScript → TypeScript ─────────────────────────────────────────────────
  {
    name: 'JavaScript → TypeScript',
    type: 'language-migration',
    from: 'JavaScript',
    to: 'TypeScript',
    removedSignals: ['.js'],
    addedSignals: ['.ts', ': string', ': number', 'interface ', 'type '],
    fileSignals: ['.ts', '.tsx'],
    searchPatterns: [
      { description: 'JavaScript files to migrate', regex: '', fileGlob: '**/*.{js,jsx}' },
    ],
  },

  // ── Axios → Fetch / native ──────────────────────────────────────────────────
  {
    name: 'Axios → Native Fetch',
    type: 'library-replacement',
    from: 'Axios',
    to: 'Native fetch API',
    removedSignals: ["from 'axios'", 'axios.get(', 'axios.post('],
    addedSignals: ['fetch(', 'Response', '.json()'],
    searchPatterns: [
      { description: "Files importing axios", regex: "from ['\"]axios['\"]", fileGlob: '**/*.{ts,tsx,js,jsx}' },
      { description: 'Axios method calls', regex: 'axios\\.(get|post|put|patch|delete)\\(', fileGlob: '**/*.{ts,tsx,js,jsx}' },
    ],
  },

  // ── Moment.js → date-fns / dayjs ────────────────────────────────────────────
  {
    name: 'Moment.js → date-fns',
    type: 'library-replacement',
    from: 'Moment.js',
    to: 'date-fns',
    removedSignals: ["from 'moment'", 'moment('],
    addedSignals: ["from 'date-fns'", 'format(', 'parseISO('],
    searchPatterns: [
      { description: 'Files using moment.js', regex: "from ['\"]moment['\"]", fileGlob: '**/*.{ts,tsx,js,jsx}' },
    ],
  },

  // ── Jest → Vitest ──────────────────────────────────────────────────────────
  {
    name: 'Jest → Vitest',
    type: 'test-migration',
    from: 'Jest',
    to: 'Vitest',
    removedSignals: ["from 'jest'", 'jest.fn(', 'jest.mock('],
    addedSignals: ["from 'vitest'", 'vi.fn(', 'vi.mock(', "import { describe, it, expect } from 'vitest'"],
    fileSignals: ['vitest.config'],
    searchPatterns: [
      { description: 'Jest configuration files', regex: '', fileGlob: '**/jest.config.{ts,js,mjs}' },
      { description: 'Files with jest.fn() calls', regex: 'jest\\.(fn|mock|spyOn)\\(', fileGlob: '**/*.{test,spec}.{ts,tsx,js,jsx}' },
    ],
  },

  // ── Express → Fastify / Hono ───────────────────────────────────────────────
  {
    name: 'Express → Fastify',
    type: 'framework-migration',
    from: 'Express.js',
    to: 'Fastify',
    removedSignals: ["from 'express'", "require('express')", 'app.use(', 'req.body', 'res.json('],
    addedSignals: ["from 'fastify'", 'fastify.register(', 'fastify.get(', 'reply.send('],
    searchPatterns: [
      { description: 'Express.js route files', regex: "from ['\"]express['\"]", fileGlob: '**/*.{ts,js}' },
    ],
  },

  // ── Prisma → Drizzle (or other ORM swaps) ──────────────────────────────────
  {
    name: 'Prisma → Drizzle ORM',
    type: 'library-replacement',
    from: 'Prisma ORM',
    to: 'Drizzle ORM',
    removedSignals: ["from '@prisma/client'", 'prisma.', 'PrismaClient'],
    addedSignals: ["from 'drizzle-orm'", 'drizzle(', 'pgTable(', 'schema.'],
    searchPatterns: [
      { description: 'Files using Prisma client', regex: "from ['\"]@prisma/client['\"]", fileGlob: '**/*.{ts,js}' },
      { description: 'Prisma method calls', regex: 'prisma\\.\\w+\\.', fileGlob: '**/*.{ts,js}' },
    ],
  },

  // ── CSS Modules → Tailwind ─────────────────────────────────────────────────
  {
    name: 'CSS Modules → Tailwind CSS',
    type: 'pattern-refactor',
    from: 'CSS Modules',
    to: 'Tailwind CSS',
    removedSignals: ["styles.", "import styles from '"],
    addedSignals: ['className="', 'tw`', 'clsx(', 'cn('],
    fileSignals: ['.module.css', '.module.scss', 'tailwind.config'],
    searchPatterns: [
      { description: 'CSS Module imports', regex: "import \\w+ from ['\"][^'\"]+\\.module\\.(css|scss)['\"]", fileGlob: '**/*.{ts,tsx,js,jsx}' },
    ],
  },

  // ── REST → GraphQL ──────────────────────────────────────────────────────────
  {
    name: 'REST API → GraphQL',
    type: 'architectural-change',
    from: 'REST API',
    to: 'GraphQL',
    removedSignals: ['fetch(', 'axios.get(', '/api/'],
    addedSignals: ['gql`', 'useQuery(', 'useMutation(', 'ApolloClient', 'graphql'],
    searchPatterns: [
      { description: 'REST API calls', regex: "fetch\\(['\"].*api/", fileGlob: '**/*.{ts,tsx,js,jsx}' },
    ],
  },

  // ── Webpack → Vite ─────────────────────────────────────────────────────────
  {
    name: 'Webpack → Vite',
    type: 'tooling-change',
    from: 'Webpack',
    to: 'Vite',
    removedSignals: ['webpack.config', 'webpack-merge', 'HtmlWebpackPlugin'],
    addedSignals: ['vite.config', "from 'vite'", 'defineConfig('],
    fileSignals: ['webpack.config', 'vite.config'],
    searchPatterns: [
      { description: 'Webpack config files', regex: '', fileGlob: '**/webpack.config.{ts,js,mjs}' },
    ],
  },

  // ── npm → pnpm / yarn → pnpm ───────────────────────────────────────────────
  {
    name: 'npm → pnpm',
    type: 'tooling-change',
    from: 'npm',
    to: 'pnpm',
    removedSignals: ['package-lock.json', 'npm run', 'npm install'],
    addedSignals: ['pnpm-lock.yaml', 'pnpm run', 'pnpm install'],
    fileSignals: ['pnpm-lock.yaml', 'package-lock.json'],
    searchPatterns: [
      { description: 'npm lock files', regex: '', fileGlob: '**/package-lock.json' },
    ],
  },

  // ── Generic API redesign ────────────────────────────────────────────────────
  {
    name: 'API Redesign',
    type: 'api-redesign',
    from: 'Old API',
    to: 'New API',
    removedSignals: [],
    addedSignals: [],
    searchPatterns: [],
  },
];

// ─── Detection logic ──────────────────────────────────────────────────────────

export function detectPatterns(
  files: PRFile[],
  fullDiff: string
): DetectedPattern[] {
  const allPatch = fullDiff;
  const removedLines = allPatch.split('\n').filter(l => l.startsWith('-')).join('\n');
  const addedLines = allPatch.split('\n').filter(l => l.startsWith('+')).join('\n');
  const allFilePaths = files.map(f => f.path + (f.oldPath ?? ''));

  const results: DetectedPattern[] = [];

  for (const rule of PATTERN_RULES) {
    if (rule.removedSignals.length === 0 && rule.addedSignals.length === 0) {
      continue;
    }

    const evidence: string[] = [];
    let matchedRemoved = 0;
    let matchedAdded = 0;

    for (const signal of rule.removedSignals) {
      if (removedLines.includes(signal)) {
        matchedRemoved++;
        evidence.push(`Removed: \`${signal}\``);
      }
    }

    for (const signal of rule.addedSignals) {
      if (addedLines.includes(signal)) {
        matchedAdded++;
        evidence.push(`Added: \`${signal}\``);
      }
    }

    let fileSignalMatched = false;
    if (rule.fileSignals) {
      for (const fs of rule.fileSignals) {
        if (allFilePaths.some(p => p.includes(fs))) {
          fileSignalMatched = true;
          evidence.push(`File change: \`${fs}\``);
        }
      }
    }

    const requiredRemoved = Math.min(1, rule.removedSignals.length);
    const requiredAdded = Math.min(1, rule.addedSignals.length);

    if (
      (matchedRemoved >= requiredRemoved && matchedAdded >= requiredAdded) ||
      (fileSignalMatched && (matchedRemoved > 0 || matchedAdded > 0))
    ) {
      const totalSignals = rule.removedSignals.length + rule.addedSignals.length;
      const matched = matchedRemoved + matchedAdded;
      const ratio = totalSignals > 0 ? matched / totalSignals : 0;

      results.push({
        type: rule.type,
        confidence: ratio > 0.6 ? 'high' : ratio > 0.3 ? 'medium' : 'low',
        from: rule.from,
        to: rule.to,
        evidence,
        searchPatterns: rule.searchPatterns,
      });
    }
  }

  // Deduplicate by type, keeping highest confidence
  const deduped = new Map<string, DetectedPattern>();
  for (const p of results) {
    const key = p.type;
    const existing = deduped.get(key);
    if (!existing || confidenceRank(p.confidence) > confidenceRank(existing.confidence)) {
      deduped.set(key, p);
    }
  }

  return Array.from(deduped.values()).sort(
    (a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence)
  );
}

function confidenceRank(c: DetectedPattern['confidence']): number {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1;
}
