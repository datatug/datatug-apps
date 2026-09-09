import { describe, expect, it } from 'vitest';
import { buildAgentUrl } from './agent-url';

describe('buildAgentUrl', () => {
  it('adds the /datatug prefix for a bare host:port store id', () => {
    expect(buildAgentUrl('localhost:8989', '/agent-info')).toBe(
      '//localhost:8989/datatug/agent-info',
    );
  });

  it('normalizes an endpoint path with no leading slash', () => {
    expect(buildAgentUrl('localhost:8989', 'agent-info')).toBe(
      '//localhost:8989/datatug/agent-info',
    );
  });

  it('works for an http- prefixed store id', () => {
    expect(buildAgentUrl('http-example.com', '/entities/all_entities')).toBe(
      'http://example.com/datatug/entities/all_entities',
    );
  });

  it('works for an https- prefixed store id', () => {
    expect(buildAgentUrl('https-example.com', '/entities/entity')).toBe(
      'https://example.com/datatug/entities/entity',
    );
  });

  it('passes a fully-qualified http(s) store id through unchanged', () => {
    expect(
      buildAgentUrl('http://localhost:8989', '/exec/select'),
    ).toBe('http://localhost:8989/datatug/exec/select');
  });

  // One test per endpoint this app's agent client uses today — see the
  // client-call -> server-route table in agent-url.ts.
  const endpoints: Array<[relativePath: string, expectedUrl: string]> = [
    ['/agent-info', '//localhost:8989/datatug/agent-info'],
    [
      '/projects/projects_summary',
      '//localhost:8989/datatug/projects/projects_summary',
    ],
    [
      '/projects/project_summary',
      '//localhost:8989/datatug/projects/project_summary',
    ],
    ['/projects/project_full', '//localhost:8989/datatug/projects/project_full'],
    ['/queries/get_query', '//localhost:8989/datatug/queries/get_query'],
    ['/queries/create_query', '//localhost:8989/datatug/queries/create_query'],
    ['/queries/update_query', '//localhost:8989/datatug/queries/update_query'],
    ['/queries/delete_query', '//localhost:8989/datatug/queries/delete_query'],
    ['/boards/board', '//localhost:8989/datatug/boards/board'],
    ['/boards/create_board', '//localhost:8989/datatug/boards/create_board'],
    ['/environment-summary', '//localhost:8989/datatug/environment-summary'],
    ['/dbserver-summary', '//localhost:8989/datatug/dbserver-summary'],
    ['/dbserver-databases', '//localhost:8989/datatug/dbserver-databases'],
    ['/dbserver-add', '//localhost:8989/datatug/dbserver-add'],
    ['/dbserver-delete', '//localhost:8989/datatug/dbserver-delete'],
    ['/entities/all_entities', '//localhost:8989/datatug/entities/all_entities'],
    ['/entities/entity', '//localhost:8989/datatug/entities/entity'],
    ['/entities/create_entity', '//localhost:8989/datatug/entities/create_entity'],
    ['/entities/save_entity', '//localhost:8989/datatug/entities/save_entity'],
    ['/entities/delete_entity', '//localhost:8989/datatug/entities/delete_entity'],
    ['/exec/execute_commands', '//localhost:8989/datatug/exec/execute_commands'],
    ['/exec/select', '//localhost:8989/datatug/exec/select'],
  ];

  it.each(endpoints)('builds the correct URL for %s', (relativePath, expected) => {
    expect(buildAgentUrl('localhost:8989', relativePath)).toBe(expected);
  });
});
