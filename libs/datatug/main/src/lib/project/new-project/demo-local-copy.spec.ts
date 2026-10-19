import { describe, expect, it } from 'vitest';
import { demoCopySlug, demoExportError, localCopyCommands } from './demo-local-copy';

describe('local edited demo handoff', () => {
  it('uses safe defaults and quotes a concrete downloaded file path without changing shell directory assumptions', () => {
    const slug = demoCopySlug('chinook');
    const commands = localCopyCommands('chinook', "/Users/a/Downloads/O'Brien $(echo bad).sqlite", slug, slug);
    expect(commands).toContain('cd chinook-datatug/demo-project-1');
    expect(commands).toContain('--directory "$PWD"');
    expect(commands).toContain("O'\"'\"'Brien $(echo bad).sqlite'");
    expect(commands).toContain('--env local --name chinook-browser');
    expect(commands).toContain('serve --project "$PWD"');
    expect(localCopyCommands('chinook', '', slug, slug)).toBeUndefined();
    expect(localCopyCommands('chinook', '/tmp/file', '../escape', slug)).toBeUndefined();
    expect(localCopyCommands('chinook', '/tmp/file\nother', slug, slug)).toBeUndefined();
  });
  it('explains provider export failures without suggesting a pristine replacement', () => {
    expect(demoExportError({ code: 'sqlite_export_too_large' })).toContain('256 MiB');
    expect(demoExportError({ code: 'sqlite_export_busy' })).toContain('Finish the current');
    expect(demoExportError({ code: 'leader_changed' })).toContain('retry');
    expect(demoExportError({ code: 'worker_unavailable' })).toContain('explicitly');
  });
});
