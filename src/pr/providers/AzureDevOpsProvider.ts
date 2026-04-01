/**
 * Azure DevOps PR provider.
 * Supports Microsoft-hosted URLs, custom domains, and server/on-prem path prefixes.
 * Uses Azure DevOps REST API 7.1.
 */

import type { PRCoordinates, PRFile, PRInfo } from '../../types.js';
import { httpGet } from '../httpClient.js';

interface ADOPRResponse {
  pullRequestId: number;
  title: string;
  description: string;
  createdBy: { displayName: string };
  sourceRefName: string;
  targetRefName: string;
  status: string;
  creationDate: string;
  lastMergeSourceCommit: { commitId: string };
}

interface ADOIterationResponse {
  id: number;
  sourceRefCommit: { commitId: string };
}

interface ADOChangeItem {
  changeType: string;
  item: { path: string };
  sourceServerItem?: string;
}

interface ADOChangesResponse {
  changeEntries: ADOChangeItem[];
}

interface ADOCommitResponse {
  commitId: string;
  comment: string;
  author: { name: string; date: string };
}

interface ADOCommitsResponse {
  value: ADOCommitResponse[];
}

export class AzureDevOpsProvider {
  constructor(private readonly token?: string) {}

  async fetch(coords: PRCoordinates): Promise<PRInfo> {
    const { apiBase, project, repo, prId } = coords;
    // apiBase preserves the original host and any server/on-prem collection prefix.
    const prBase = `${apiBase}/${project}/_apis/git/repositories/${repo}/pullRequests/${prId}`;

    const headers = this.headers();
    const apiVer = 'api-version=7.1';

    const pr = await httpGet<ADOPRResponse>(`${prBase}?${apiVer}`, headers);

    // Fetch latest iteration id to get file changes
    const iterations = await httpGet<{ value: ADOIterationResponse[] }>(
      `${prBase}/iterations?${apiVer}`,
      headers,
    );
    const latestIteration = iterations.value[iterations.value.length - 1];
    const iterationId = latestIteration?.id ?? 1;

    const [changesResp, commitsResp] = await Promise.all([
      httpGet<ADOChangesResponse>(
        `${prBase}/iterations/${iterationId}/changes?${apiVer}`,
        headers,
      ),
      httpGet<ADOCommitsResponse>(`${prBase}/commits?${apiVer}`, headers),
    ]);

    const files: PRFile[] = changesResp.changeEntries.map((entry) => ({
      path: entry.item.path.replace(/^\//, ''),
      status: this.mapChangeType(entry.changeType),
      oldPath: entry.sourceServerItem?.replace(/^\//, ''),
      additions: 0, // ADO changes API does not return line counts
      deletions: 0,
      patch: undefined, // ADO does not return unified diff per file at this endpoint
    }));

    // Attempt to fetch a unified diff for the whole PR via the diffs endpoint
    const sourceCommit = pr.lastMergeSourceCommit.commitId;
    let fullDiff = '';
    try {
      // ADO returns a JSON diff, not a unified patch — we build a summary instead
      fullDiff =
        `PR: ${pr.title}\n` +
        files.map((f) => `${f.status.toUpperCase()}: ${f.path}`).join('\n');
    } catch {
      fullDiff = files
        .map((f) => `${f.status.toUpperCase()}: ${f.path}`)
        .join('\n');
    }
    void sourceCommit; // used for future diff fetch

    return {
      coordinates: coords,
      title: pr.title,
      description: pr.description ?? '',
      author: pr.createdBy.displayName,
      sourceBranch: pr.sourceRefName.replace('refs/heads/', ''),
      targetBranch: pr.targetRefName.replace('refs/heads/', ''),
      state: pr.status,
      files,
      commits: commitsResp.value.map((c) => ({
        sha: c.commitId.slice(0, 7),
        message: c.comment.split('\n')[0] ?? c.comment,
        author: c.author.name,
        timestamp: c.author.date,
      })),
      fullDiff,
      createdAt: pr.creationDate,
    };
  }

  private mapChangeType(ct: string): PRFile['status'] {
    const lower = ct.toLowerCase();
    if (lower.includes('add')) {
      return 'added';
    }
    if (lower.includes('delete')) {
      return 'removed';
    }
    if (lower.includes('rename')) {
      return 'renamed';
    }
    if (lower.includes('copy')) {
      return 'copied';
    }
    return 'modified';
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      // ADO uses Basic auth with PAT: base64(":{pat}")
      const encoded = Buffer.from(`:${this.token}`).toString('base64');
      h['Authorization'] = `Basic ${encoded}`;
    }
    return h;
  }
}
