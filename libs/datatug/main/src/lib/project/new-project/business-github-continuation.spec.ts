import {
  clearBusinessGithubContinuation,
  saveBusinessGithubContinuation,
  takeBusinessGithubContinuation,
} from './business-github-continuation';

describe('Business GitHub continuation', () => {
  beforeEach(clearBusinessGithubContinuation);
  afterEach(clearBusinessGithubContinuation);

  it('is one-shot and bound to the authenticated actor', () => {
    expect(saveBusinessGithubContinuation('actor-a', 'space-a', 1_000)).toBe(
      true,
    );

    expect(takeBusinessGithubContinuation('actor-b', 2_000)).toBeUndefined();
    expect(takeBusinessGithubContinuation('actor-a', 2_000)).toBeUndefined();
  });

  it('expires after thirty minutes and rejects malformed Space identifiers', () => {
    expect(saveBusinessGithubContinuation('actor-a', 'space-a', 1_000)).toBe(
      true,
    );
    expect(
      takeBusinessGithubContinuation('actor-a', 1_000 + 30 * 60 * 1000 + 1),
    ).toBeUndefined();

    expect(saveBusinessGithubContinuation('actor-a', '../space', 1_000)).toBe(
      false,
    );
  });
});
