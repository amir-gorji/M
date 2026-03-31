/**
 * PR URL parsing helpers that do not depend on VS Code runtime APIs.
 */

import type { PRCoordinates } from '../types.js';

/**
 * Extract the first URL from a freeform string (the user may type prose around it).
 */
export function extractPRUrl(text: string): string | null {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const matches = text.match(urlRegex);
  if (!matches) {
    return null;
  }
  // Prefer URLs that look like PRs/MRs
  const prLike = matches.find(
    (u) =>
      /\/(pull|pullrequest|pullrequests|merge_requests?)\//i.test(u) ||
      /\/_git\/.*\/pullrequest/i.test(u),
  );
  return prLike ?? matches[0] ?? null;
}

function parseAzureDevOpsUrl(rawUrl: string): PRCoordinates | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const segments = parsed.pathname
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);

  if (segments.length < 5) {
    return null;
  }

  const project = segments[segments.length - 5];
  const gitMarker = segments[segments.length - 4];
  const repo = segments[segments.length - 3];
  const prMarker = segments[segments.length - 2];
  const prId = segments[segments.length - 1];

  if (!project || !gitMarker || !repo || !prMarker || !prId) {
    return null;
  }
  if (gitMarker !== '_git') {
    return null;
  }
  if (!/^pullrequests?$/i.test(prMarker)) {
    return null;
  }
  if (!/^\d+$/.test(prId)) {
    return null;
  }

  const hostname = parsed.hostname;
  const isDevAzure = hostname === 'dev.azure.com';
  const isVSO = hostname.endsWith('.visualstudio.com');

  const apiBaseSegments = segments.slice(0, -5);

  // For visualstudio.com, rewrite to dev.azure.com so API calls use the
  // canonical host (both hosts serve the API, but dev.azure.com is preferred).
  let apiBase: string;
  let owner: string;

  if (isDevAzure) {
    // https://dev.azure.com/{org}/… — org is first path segment
    apiBase =
      apiBaseSegments.length > 0
        ? `${parsed.origin}/${apiBaseSegments.join('/')}`
        : parsed.origin;
    owner = apiBaseSegments[0] ?? hostname;
  } else if (isVSO) {
    // https://{org}.visualstudio.com/… — org is subdomain; rewrite to dev.azure.com
    const org = hostname.replace(/\.visualstudio\.com$/i, '');
    apiBase = `https://dev.azure.com/${org}`;
    owner = org;
  } else {
    // Custom domain or on-prem server — keep original host + any collection prefix
    apiBase =
      apiBaseSegments.length > 0
        ? `${parsed.origin}/${apiBaseSegments.join('/')}`
        : parsed.origin;
    // Best-effort owner: first path segment (collection name) or hostname
    owner = apiBaseSegments[0] ?? hostname;
  }

  return {
    provider: 'azure-devops',
    url: rawUrl,
    apiBase,
    owner,
    project,
    repo,
    prId,
  };
}

/**
 * Parse a PR/MR URL into structured coordinates.
 * Returns null if the URL is not recognisable.
 */
export function parsePRUrl(rawUrl: string): PRCoordinates | null {
  // Strip query params and trailing slashes for matching but keep original
  const url = rawUrl.split('?')[0]!.replace(/\/+$/, '');

  // ── Azure DevOps ────────────────────────────────────────────────────────
  // Checked first because it matches on `_git` — a marker unique to ADO.
  // Other providers (GitHub, GitLab, Bitbucket) never use `_git` in their
  // PR URL paths, so there is no ambiguity. If a future provider introduces
  // `_git`, this block must be moved after that provider's check.
  //
  // https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}
  // https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}
  // https://{host}/{project}/_git/{repo}/pullrequest/{id}
  // https://{host}/{collection}/{project}/_git/{repo}/pullrequest/{id}
  const azureDevOps = parseAzureDevOpsUrl(rawUrl);
  if (azureDevOps) {
    return azureDevOps;
  }

  // ── GitHub.com ──────────────────────────────────────────────────────────
  // https://github.com/{owner}/{repo}/pull/{number}
  const github = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i,
  );
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
  const gitlabCom = url.match(
    /^(https:\/\/gitlab\.com)(\/[^/]+\/[^/]+(?:\/[^/]+)*)?\/-\/merge_requests\/(\d+)/i,
  );
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
  const bitbucket = url.match(
    /^https:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/i,
  );
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
  // Must come after GitHub.com check and Azure DevOps detection.
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
    /^(https?:\/\/[^/]+)\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/i,
  );
  if (bbServer) {
    return {
      provider: 'bitbucket-server',
      url: rawUrl,
      apiBase: `${bbServer[1]!}/rest/api/1.0`,
      owner: bbServer[2]!,
      repo: bbServer[3]!,
      prId: bbServer[4]!,
    };
  }

  // ── Self-hosted GitLab ───────────────────────────────────────────────────
  // https://{host}/{namespace}/{repo}/-/merge_requests/{id}
  const gitlabSelf = url.match(
    /^(https?:\/\/[^/]+)((?:\/[^/]+){2,})\/-\/merge_requests\/(\d+)/i,
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
