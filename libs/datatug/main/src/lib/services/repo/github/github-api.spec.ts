import { describe, expect, it } from 'vitest';

import { GithubRepoError, requireGithubRepo, toGithubRepo } from './github-api';

describe('toGithubRepo', () => {
  it('maps a complete payload', () => {
    expect(
      toGithubRepo({
        full_name: 'datatug/demo',
        private: true,
        default_branch: 'trunk',
      }),
    ).toEqual({
      fullName: 'datatug/demo',
      private: true,
      defaultBranch: 'trunk',
    });
  });

  it('builds the full name from the owner and the name, and reads a missing private as public', () => {
    expect(
      toGithubRepo({
        owner: { login: 'datatug' },
        name: 'demo',
        default_branch: 'main',
      }),
    ).toEqual({
      fullName: 'datatug/demo',
      private: false,
      defaultBranch: 'main',
    });
  });

  it.each([
    ['no full name', { default_branch: 'main' }],
    [
      'an owner without a name',
      { owner: { login: 'datatug' }, default_branch: 'main' },
    ],
    [
      'no default branch (never assumed to be main)',
      { full_name: 'datatug/demo' },
    ],
    [
      'an empty default branch',
      { full_name: 'datatug/demo', default_branch: '' },
    ],
  ])('is incomplete with %s', (_name, wire) => {
    expect(toGithubRepo(wire)).toBeUndefined();
  });
});

describe('requireGithubRepo', () => {
  it('returns the repository when it is complete', () => {
    expect(
      requireGithubRepo(
        { full_name: 'datatug/demo', default_branch: 'main' },
        'x',
      ).defaultBranch,
    ).toBe('main');
  });

  it.each([
    [
      'no default branch',
      { full_name: 'datatug/demo' },
      false,
      'default-branch',
      'GitHub did not return the default branch of datatug/demo, so DataTug cannot tell which branch to commit to.',
    ],
    [
      'no default branch, owner and name given',
      { owner: { login: 'datatug' }, name: 'demo' },
      false,
      'default-branch',
      'GitHub did not return the default branch of datatug/demo, so DataTug cannot tell which branch to commit to.',
    ],
    [
      'no default branch of a repository just created',
      { full_name: 'datatug/demo' },
      true,
      'default-branch',
      'GitHub created datatug/demo, but did not return the default branch of datatug/demo, so DataTug cannot tell which branch to commit to.',
    ],
    [
      'no name',
      {},
      false,
      'full-name',
      'GitHub did not return the repository datatug/demo',
    ],
    [
      'no name of a repository just created',
      { default_branch: 'main' },
      true,
      'full-name',
      'GitHub created datatug/demo, but did not return its full name',
    ],
  ])('says what is missing: %s', (_name, wire, created, missing, message) => {
    let error: unknown;
    try {
      requireGithubRepo(wire, 'datatug/demo', created);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(GithubRepoError);
    expect((error as GithubRepoError).missing).toBe(missing);
    expect((error as GithubRepoError).message).toBe(message);
  });
});
