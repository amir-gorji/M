import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePRUrl } from './PRUrlParser.js';

test('parses dev.azure.com pull request URLs', () => {
  const parsed = parsePRUrl(
    'https://dev.azure.com/acme/payments/_git/web/pullrequest/123',
  );

  assert.deepEqual(parsed, {
    provider: 'azure-devops',
    url: 'https://dev.azure.com/acme/payments/_git/web/pullrequest/123',
    apiBase: 'https://dev.azure.com/acme',
    owner: 'acme',
    project: 'payments',
    repo: 'web',
    prId: '123',
  });
});

test('parses legacy visualstudio.com pull request URLs and rewrites apiBase to dev.azure.com', () => {
  const parsed = parsePRUrl(
    'https://acme.visualstudio.com/payments/_git/web/pullrequest/456',
  );

  assert.deepEqual(parsed, {
    provider: 'azure-devops',
    url: 'https://acme.visualstudio.com/payments/_git/web/pullrequest/456',
    apiBase: 'https://dev.azure.com/acme',
    owner: 'acme',
    project: 'payments',
    repo: 'web',
    prId: '456',
  });
});

test('parses custom-domain Azure DevOps URLs', () => {
  const parsed = parsePRUrl(
    'https://ado.company.com/payments/_git/web/pullrequest/789',
  );

  assert.deepEqual(parsed, {
    provider: 'azure-devops',
    url: 'https://ado.company.com/payments/_git/web/pullrequest/789',
    apiBase: 'https://ado.company.com',
    owner: 'ado.company.com',
    project: 'payments',
    repo: 'web',
    prId: '789',
  });
});

test('parses collection-prefixed Azure DevOps Server URLs', () => {
  const parsed = parsePRUrl(
    'https://ado.company.com/DefaultCollection/payments/_git/web/pullrequest/321',
  );

  assert.deepEqual(parsed, {
    provider: 'azure-devops',
    url: 'https://ado.company.com/DefaultCollection/payments/_git/web/pullrequest/321',
    apiBase: 'https://ado.company.com/DefaultCollection',
    owner: 'DefaultCollection',
    project: 'payments',
    repo: 'web',
    prId: '321',
  });
});

test('parses deeper Azure DevOps Server prefixes and ignores query strings (plural "pullrequests")', () => {
  // Intentionally uses "pullrequests" (plural) to verify the parser accepts both forms.
  const parsed = parsePRUrl(
    'https://ado.company.com/tfs/DefaultCollection/payments/_git/web/pullrequests/654?path=%2Fsrc',
  );

  assert.deepEqual(parsed, {
    provider: 'azure-devops',
    url: 'https://ado.company.com/tfs/DefaultCollection/payments/_git/web/pullrequests/654?path=%2Fsrc',
    apiBase: 'https://ado.company.com/tfs/DefaultCollection',
    owner: 'tfs',
    project: 'payments',
    repo: 'web',
    prId: '654',
  });
});

test('does not misclassify GitHub Enterprise URLs as Azure DevOps', () => {
  const parsed = parsePRUrl('https://git.company.com/org/repo/pull/42');

  assert.deepEqual(parsed, {
    provider: 'github-enterprise',
    url: 'https://git.company.com/org/repo/pull/42',
    apiBase: 'https://git.company.com/api/v3',
    owner: 'org',
    repo: 'repo',
    prId: '42',
  });
});
