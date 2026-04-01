/**
 * PR URL detection and dispatch to the appropriate provider.
 *
 * Supports:
 *  - GitHub (github.com)
 *  - GitHub Enterprise (any domain with /pull/ path pattern)
 *  - Azure DevOps (Microsoft-hosted, custom domains, and server/on-prem)
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
export { extractPRUrl, parsePRUrl } from './PRUrlParser.js';

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
