import { describe, expect, it } from 'vitest';
import { buildGithubProjectSummaryUrl } from './datatug-store.service.github';

describe('buildGithubProjectSummaryUrl', () => {
  it('defaults to a "datatug" folder when none is given', () => {
    expect(buildGithubProjectSummaryUrl('my-repo@my-org')).toBe(
      'https://raw.githubusercontent.com/my-org/my-repo/main/datatug/datatug-project.json',
    );
  });

  it('uses an explicit folder when a third "@"-separated part is given', () => {
    expect(
      buildGithubProjectSummaryUrl('my-repo@my-org@some-folder'),
    ).toBe(
      'https://raw.githubusercontent.com/my-org/my-repo/main/some-folder/datatug-project.json',
    );
  });

  it('builds the demo project link at the documented URL', () => {
    // https://github.com/datatug/datatug-demo-projects/blob/main/demo-project-1/datatug-project.json
    expect(
      buildGithubProjectSummaryUrl(
        'datatug-demo-projects@datatug@demo-project-1',
      ),
    ).toBe(
      'https://raw.githubusercontent.com/datatug/datatug-demo-projects/main/demo-project-1/datatug-project.json',
    );
  });
});
