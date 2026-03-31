/**
 * GitHub and GitHub Enterprise PR provider.
 * Uses the GitHub REST API v3.
 */

import type { PRCoordinates, PRFile, PRInfo } from '../../types.js';
import { httpGet } from '../httpClient.js';

interface GHPRResponse {
  number: number;
  title: string;
  body: string | null;
  user: { login: string };
  head: { ref: string };
  base: { ref: string };
  state: string;
  created_at: string;
}

interface GHFileResponse {
  filename: string;
  status: string;
  previous_filename?: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface GHCommitResponse {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
}

export class GitHubProvider {
  constructor(private readonly token?: string) {}

  async fetch(coords: PRCoordinates): Promise<PRInfo> {
    const { apiBase, owner, repo, prId } = coords;
    const base = `${apiBase}/repos/${owner}/${repo}/pulls/${prId}`;

    const headers = this.headers();

    const [pr, ghFiles, commits] = await Promise.all([
      httpGet<GHPRResponse>(base, headers),
      httpGet<GHFileResponse[]>(`${base}/files`, headers),
      httpGet<GHCommitResponse[]>(`${base}/commits`, headers),
    ]);

    const files: PRFile[] = ghFiles.map(f => ({
      path: f.filename,
      status: this.mapStatus(f.status),
      oldPath: f.previous_filename,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));

    const fullDiff = files
      .filter(f => f.patch)
      .map(f => `--- a/${f.oldPath ?? f.path}\n+++ b/${f.path}\n${f.patch}`)
      .join('\n\n');

    return {
      coordinates: coords,
      title: pr.title,
      description: pr.body ?? '',
      author: pr.user.login,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      state: pr.state,
      files,
      commits: commits.map(c => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0] ?? c.commit.message,
        author: c.commit.author.name,
        timestamp: c.commit.author.date,
      })),
      fullDiff,
      createdAt: pr.created_at,
    };
  }

  private mapStatus(s: string): PRFile['status'] {
    switch (s) {
      case 'added': return 'added';
      case 'removed': return 'removed';
      case 'renamed': return 'renamed';
      case 'copied': return 'copied';
      default: return 'modified';
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) { h['Authorization'] = `Bearer ${this.token}`; }
    return h;
  }
}
