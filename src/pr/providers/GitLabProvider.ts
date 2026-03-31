/**
 * GitLab MR provider.
 * Supports gitlab.com and self-hosted instances.
 * Uses GitLab REST API v4.
 */

import type { PRCoordinates, PRFile, PRInfo } from '../../types.js';
import { httpGet } from '../httpClient.js';

interface GLMRResponse {
  iid: number;
  title: string;
  description: string | null;
  author: { username: string };
  source_branch: string;
  target_branch: string;
  state: string;
  created_at: string;
  project_id: number;
  sha: string;
}

interface GLDiffResponse {
  old_path: string;
  new_path: string;
  new_file: boolean;
  deleted_file: boolean;
  renamed_file: boolean;
  diff: string;
}

interface GLCommitResponse {
  id: string;
  title: string;
  author_name: string;
  created_at: string;
}

export class GitLabProvider {
  constructor(private readonly token?: string) {}

  async fetch(coords: PRCoordinates): Promise<PRInfo> {
    const { apiBase, owner, repo, prId } = coords;

    // GitLab requires URL-encoded project path as the project id
    const projectPath = owner ? `${owner}/${repo}` : repo;
    const encodedPath = encodeURIComponent(projectPath);

    const mrBase = `${apiBase}/projects/${encodedPath}/merge_requests/${prId}`;
    const headers = this.headers();

    const [mr, diffs, commits] = await Promise.all([
      httpGet<GLMRResponse>(mrBase, headers),
      httpGet<GLDiffResponse[]>(`${mrBase}/diffs`, headers),
      httpGet<GLCommitResponse[]>(`${mrBase}/commits`, headers),
    ]);

    const files: PRFile[] = diffs.map(d => {
      const lines = d.diff.split('\n');
      const additions = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
      const deletions = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
      return {
        path: d.new_path,
        status: d.new_file
          ? 'added'
          : d.deleted_file
            ? 'removed'
            : d.renamed_file
              ? 'renamed'
              : 'modified',
        oldPath: d.renamed_file ? d.old_path : undefined,
        additions,
        deletions,
        patch: d.diff,
      };
    });

    const fullDiff = diffs
      .map(d => `--- a/${d.old_path}\n+++ b/${d.new_path}\n${d.diff}`)
      .join('\n\n');

    return {
      coordinates: coords,
      title: mr.title,
      description: mr.description ?? '',
      author: mr.author.username,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      state: mr.state,
      files,
      commits: commits.map(c => ({
        sha: c.id.slice(0, 7),
        message: c.title,
        author: c.author_name,
        timestamp: c.created_at,
      })),
      fullDiff,
      createdAt: mr.created_at,
    };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) { h['PRIVATE-TOKEN'] = this.token; }
    return h;
  }
}
