/**
 * PR URL detection and dispatch to the appropriate provider.
 *
 * Supports:
 *  - GitHub (github.com)
 *  - GitHub Enterprise (any domain with /pull/ path pattern)
 *  - Azure DevOps (dev.azure.com and *.visualstudio.com)
 *  - GitLab (gitlab.com and self-hosted)
 *  - Bitbucket Cloud (bitbucket.org)
 *  - Bitbucket Server / Data Center (self-hosted)
 */

import * as vscode from 'vscode';
import type { PRCoordinates, PRInfo, PRProvider } from '../types.js';
import { GitHubProvider } from './providers/GitHubProvider.js';
import { AzureDevOpsProvider } from './providers/AzureDevOpsProvider.js';
import { GitLabProvider } from './providers/GitLabProvider.js';
import { BitbucketProvider } from './providers/BitbucketProvider.js';

// ─── URL parsing ─────────────────────────────────────────────────────────────

/**
 * Extract the first URL from a freeform string (the user may type prose around it).
 */
export function extractPRUrl(text: string): string | null {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const matches = text.match(urlRegex);
  if (!matches) { return null; }
  // Prefer URLs that look like PRs/MRs
  const prLike = matches.find(u =>
    /\/(pull|pullrequest|pullrequests|merge_requests?)\//i.test(u) ||
    /\/_git\/.*\/pullrequest/i.test(u)
  );
  return prLike ?? matches[0] ?? null;
}

/**
 * Parse a PR/MR URL into structured coordinates.
 * Returns null if the URL is not recognisable.
 */
export function parsePRUrl(rawUrl: string): PRCoordinates | null {
  // Strip query params and trailing slashes for matching but keep original
  const url = rawUrl.split('?')[0]!.replace(/\/+$/, '');

  // ── Azure DevOps ────────────────────────────────────────────────────────
  // https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}
  // https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}
  const adoDevAzure = url.match(
    /^(https:\/\/dev\.azure\.com\/([^/]+))\/([^/]+)\/_git\/([^/]+)\/pullrequests?\/(\d+)/i
  );
  if (adoDevAzure) {
    return {
      provider: 'azure-devops',
      url: rawUrl,
      apiBase: adoDevAzure[1]!,
      owner: adoDevAzure[2]!, // org
      project: adoDevAzure[3]!,
      repo: adoDevAzure[4]!,
      prId: adoDevAzure[5]!,
    };
  }

  const adoVSO = url.match(
    /^(https:\/\/([^.]+)\.visualstudio\.com)\/([^/]+)\/_git\/([^/]+)\/pullrequests?\/(\d+)/i
  );
  if (adoVSO) {
    return {
      provider: 'azure-devops',
      url: rawUrl,
      apiBase: `https://dev.azure.com/${adoVSO[2]!}`,
      owner: adoVSO[2]!, // org (derived from subdomain)
      project: adoVSO[3]!,
      repo: adoVSO[4]!,
      prId: adoVSO[5]!,
    };
  }

  // ── GitHub.com ──────────────────────────────────────────────────────────
  // https://github.com/{owner}/{repo}/pull/{number}
  const github = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (github) {
    return {
      provider: 'github',
      url: rawUrl,
      apiBase: 'https://api.github.com',
      owner: github[1]!,
      repo: github[2]!,
      prId: github[3]!,
    };
  }

  // ── GitLab.com ──────────────────────────────────────────────────────────
  // https://gitlab.com/{namespace}/{repo}/-/merge_requests/{id}
  // https://gitlab.com/{group}/{subgroup}/{repo}/-/merge_requests/{id}
  const gitlabCom = url.match(/^(https:\/\/gitlab\.com)(\/[^/]+\/[^/]+(?:\/[^/]+)*)?\/-\/merge_requests\/(\d+)/i);
  if (gitlabCom) {
    const fullPath = gitlabCom[2]?.replace(/^\//, '') ?? '';
    const parts = fullPath.split('/');
    const repoName = parts.pop() ?? fullPath;
    return {
      provider: 'gitlab',
      url: rawUrl,
      apiBase: 'https://gitlab.com/api/v4',
      owner: parts.join('/') || undefined,
      repo: repoName,
      prId: gitlabCom[3]!,
    };
  }

  // ── Bitbucket Cloud ─────────────────────────────────────────────────────
  // https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}
  const bitbucket = url.match(/^https:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/i);
  if (bitbucket) {
    return {
      provider: 'bitbucket',
      url: rawUrl,
      apiBase: 'https://api.bitbucket.org/2.0',
      owner: bitbucket[1]!,
      repo: bitbucket[2]!,
      prId: bitbucket[3]!,
    };
  }

  // ── GitHub Enterprise ───────────────────────────────────────────────────
  // https://{enterprise-host}/{owner}/{repo}/pull/{number}
  // Must come after GitHub.com check.
  const ghe = url.match(/^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (ghe) {
    return {
      provider: 'github-enterprise',
      url: rawUrl,
      apiBase: `${ghe[1]!}/api/v3`,
      owner: ghe[2]!,
      repo: ghe[3]!,
      prId: ghe[4]!,
    };
  }

  // ── Bitbucket Server / Data Center ──────────────────────────────────────
  // https://{host}/projects/{key}/repos/{repo}/pull-requests/{id}
  const bbServer = url.match(
    /^(https?:\/\/[^/]+)\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/i
  );
  if (bbServer) {
    return {
      provider: 'bitbucket-server',
      url: rawUrl,
      apiBase: `${bbServer[1]!}/rest/api/1.0`,
      owner: bbServer[2]!, // project key
      repo: bbServer[3]!,
      prId: bbServer[4]!,
    };
  }

  // ── Self-hosted GitLab ───────────────────────────────────────────────────
  // https://{host}/{namespace}/{repo}/-/merge_requests/{id}
  const gitlabSelf = url.match(
    /^(https?:\/\/[^/]+)((?:\/[^/]+){2,})\/-\/merge_requests\/(\d+)/i
  );
  if (gitlabSelf) {
    const fullPath = gitlabSelf[2]!.replace(/^\//, '');
    const parts = fullPath.split('/');
    const repoName = parts.pop() ?? fullPath;
    return {
      provider: 'gitlab',
      url: rawUrl,
      apiBase: `${gitlabSelf[1]!}/api/v4`,
      owner: parts.join('/') || undefined,
      repo: repoName,
      prId: gitlabSelf[3]!,
    };
  }

  return null;
}

// ─── Token helpers ────────────────────────────────────────────────────────────

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('kitsune');
}

export function getTokenForProvider(provider: PRProvider): string | undefined {
  const cfg = getConfig();
  switch (provider) {
    case 'github':
    case 'github-enterprise':
      return cfg.get<string>('github.token') || undefined;
    case 'azure-devops':
      return cfg.get<string>('azureDevOps.token') || undefined;
    case 'gitlab':
      return cfg.get<string>('gitlab.token') || undefined;
    case 'bitbucket':
    case 'bitbucket-server':
      return cfg.get<string>('bitbucket.appPassword') || undefined;
  }
}

// ─── Main fetch dispatcher ────────────────────────────────────────────────────

export async function fetchPR(coordinates: PRCoordinates): Promise<PRInfo> {
  const token = getTokenForProvider(coordinates.provider);

  switch (coordinates.provider) {
    case 'github':
    case 'github-enterprise':
      return new GitHubProvider(token).fetch(coordinates);

    case 'azure-devops':
      return new AzureDevOpsProvider(token).fetch(coordinates);

    case 'gitlab':
      return new GitLabProvider(token).fetch(coordinates);

    case 'bitbucket':
    case 'bitbucket-server':
      return new BitbucketProvider(token, getConfig().get<string>('bitbucket.username')).fetch(coordinates);

    default: {
      const exhaustive: never = coordinates.provider;
      throw new Error(`Unsupported PR provider: ${exhaustive}`);
    }
  }
}
