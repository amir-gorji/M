/**
 * Bitbucket Cloud and Bitbucket Server / Data Center PR provider.
 * Cloud: api.bitbucket.org/2.0
 * Server: {host}/rest/api/1.0
 */

import type { PRCoordinates, PRFile, PRInfo } from '../../types.js';
import { httpGet } from '../httpClient.js';

// ── Bitbucket Cloud types ────────────────────────────────────────────────────

interface BBCloudPRResponse {
  id: number;
  title: string;
  description: string;
  author: { display_name: string };
  source: { branch: { name: string } };
  destination: { branch: { name: string } };
  state: string;
  created_on: string;
}

interface BBCloudDiffstatEntry {
  old: { path: string } | null;
  new: { path: string } | null;
  type: 'added' | 'removed' | 'modified' | 'renamed';
  lines_added: number;
  lines_removed: number;
}

interface BBCloudDiffstatResponse {
  values: BBCloudDiffstatEntry[];
}

interface BBCloudCommit {
  hash: string;
  message: string;
  author: { raw: string };
  date: string;
}

interface BBCloudCommitsResponse {
  values: BBCloudCommit[];
}

// ── Bitbucket Server types ───────────────────────────────────────────────────

interface BBServerPRResponse {
  id: number;
  title: string;
  description?: string;
  author: { user: { displayName: string } };
  fromRef: { displayId: string };
  toRef: { displayId: string };
  state: string;
  createdDate: number;
}

interface BBServerChange {
  path: { toString: string };
  srcPath?: { toString: string };
  type: string;
}

interface BBServerChangesResponse {
  values: BBServerChange[];
}

export class BitbucketProvider {
  constructor(
    private readonly appPassword?: string,
    private readonly username?: string
  ) {}

  async fetch(coords: PRCoordinates): Promise<PRInfo> {
    return coords.provider === 'bitbucket-server'
      ? this.fetchServer(coords)
      : this.fetchCloud(coords);
  }

  // ── Cloud ──────────────────────────────────────────────────────────────────

  private async fetchCloud(coords: PRCoordinates): Promise<PRInfo> {
    const { apiBase, owner, repo, prId } = coords;
    const prBase = `${apiBase}/repositories/${owner}/${repo}/pullrequests/${prId}`;
    const headers = this.cloudHeaders();

    const [pr, diffstat, commits, rawDiff] = await Promise.all([
      httpGet<BBCloudPRResponse>(prBase, headers),
      httpGet<BBCloudDiffstatResponse>(`${prBase}/diffstat`, headers),
      httpGet<BBCloudCommitsResponse>(`${prBase}/commits`, headers),
      httpGet<string>(`${prBase}/diff`, headers, true),
    ]);

    const files: PRFile[] = diffstat.values.map(entry => ({
      path: entry.new?.path ?? entry.old?.path ?? '',
      status: this.mapBBCloudType(entry.type),
      oldPath: entry.type === 'renamed' ? (entry.old?.path) : undefined,
      additions: entry.lines_added,
      deletions: entry.lines_removed,
    }));

    return {
      coordinates: coords,
      title: pr.title,
      description: pr.description ?? '',
      author: pr.author.display_name,
      sourceBranch: pr.source.branch.name,
      targetBranch: pr.destination.branch.name,
      state: pr.state.toLowerCase(),
      files,
      commits: commits.values.map(c => ({
        sha: c.hash.slice(0, 7),
        message: c.message.split('\n')[0] ?? c.message,
        author: c.author.raw.replace(/<.*>/, '').trim(),
        timestamp: c.date,
      })),
      fullDiff: typeof rawDiff === 'string' ? rawDiff : '',
      createdAt: pr.created_on,
    };
  }

  // ── Server ─────────────────────────────────────────────────────────────────

  private async fetchServer(coords: PRCoordinates): Promise<PRInfo> {
    const { apiBase, owner: projectKey, repo, prId } = coords;
    const prBase = `${apiBase}/projects/${projectKey}/repos/${repo}/pull-requests/${prId}`;
    const headers = this.serverHeaders();

    const [pr, changes] = await Promise.all([
      httpGet<BBServerPRResponse>(prBase, headers),
      httpGet<BBServerChangesResponse>(`${prBase}/changes`, headers),
    ]);

    const files: PRFile[] = changes.values.map(c => ({
      path: c.path.toString,
      status: this.mapBBServerType(c.type),
      oldPath: c.srcPath?.toString,
      additions: 0,
      deletions: 0,
    }));

    let fullDiff = '';
    try {
      fullDiff = await httpGet<string>(`${prBase}/diff`, headers, true);
    } catch { /* diff may require additional perms */ }

    return {
      coordinates: coords,
      title: pr.title,
      description: pr.description ?? '',
      author: pr.author.user.displayName,
      sourceBranch: pr.fromRef.displayId,
      targetBranch: pr.toRef.displayId,
      state: pr.state.toLowerCase(),
      files,
      commits: [],
      fullDiff,
      createdAt: new Date(pr.createdDate).toISOString(),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private mapBBCloudType(t: string): PRFile['status'] {
    switch (t) {
      case 'added': return 'added';
      case 'removed': return 'removed';
      case 'renamed': return 'renamed';
      default: return 'modified';
    }
  }

  private mapBBServerType(t: string): PRFile['status'] {
    const u = t.toUpperCase();
    if (u === 'ADD') { return 'added'; }
    if (u === 'DELETE') { return 'removed'; }
    if (u === 'MOVE' || u === 'RENAME') { return 'renamed'; }
    return 'modified';
  }

  private cloudHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.username && this.appPassword) {
      const encoded = Buffer.from(`${this.username}:${this.appPassword}`).toString('base64');
      h['Authorization'] = `Basic ${encoded}`;
    }
    return h;
  }

  private serverHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.appPassword) {
      // Server supports Bearer token (personal access token)
      h['Authorization'] = `Bearer ${this.appPassword}`;
    }
    return h;
  }
}
