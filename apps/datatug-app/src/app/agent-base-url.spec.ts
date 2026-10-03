import { GITHUB_STORE_ID } from '@datatug/project-address';
import { describe, expect, it } from 'vitest';
import {
  agentBaseUrlOfPath,
  DEFAULT_AGENT_STORE_ID,
  GITHUB_STORE_IDS,
  NO_AGENT_BASE_URL,
} from './agent-base-url';

// G-A1c (design `demo-as-github-project.md` 3.4, `main.ts:103`): the base URL of the agent API is read from the
// address with `parseProjectUrl`. A GitHub project, at either of its addresses, has no agent: it used to get the
// default local agent on its short address, so a public page called `localhost:8989`.
describe('agentBaseUrlOfPath', () => {
  it.each([
    // [address, the agent API base URL]
    ['/store/localhost:8989', '//localhost:8989/datatug'],
    ['/store/localhost:8989/project/p1', '//localhost:8989/datatug'],
    [
      '/store/localhost:8989/project/p1/queries/folder/q',
      '//localhost:8989/datatug',
    ],
    [
      '/store/http-localhost:8989/project/p1/chat',
      'http://localhost:8989/datatug',
    ],
    [
      '/store/https-agent.example.com/project/p1',
      'https://agent.example.com/datatug',
    ],
    ['/store/http-localhost:8989', 'http://localhost:8989/datatug'],
    [
      '/store/http%2Dlocalhost%3A8989/project/p1',
      'http://localhost:8989/datatug',
    ],
    // No store in the address: the default local agent, as before.
    ['/', `//${DEFAULT_AGENT_STORE_ID}/datatug`],
    ['/my', '//localhost:8989/datatug'],
    ['/demo', '//localhost:8989/datatug'],
    ['/store', '//localhost:8989/datatug'],
    ['/storefront/x', '//localhost:8989/datatug'],
    // An id that cannot be decoded is used as typed (the router matches no store with it either).
    ['/store/%E0%A4%A', '//%E0%A4%A:undefined/datatug'],
  ])('%s has the agent %s', (path, base) => {
    expect(agentBaseUrlOfPath(path)).toBe(base);
  });

  it.each([
    // A GitHub project at its short address, in every form it can be typed: no agent.
    '/project/github.com/datatug/chinook-demo',
    '/project/github.com/datatug/chinook-demo/chat',
    '/project/github.com/o/r/tree/HEAD/d/-/queries',
    '/project/github.com/o/r/tree/v1.0.0/-/chat',
    '/Project/GitHub.com/o/r/chat',
    '/project/github.com/o/r/queries;a=1',
    '//project/github.com/o/r',
    '/(project/github.com/o/r/chat)',
    // Any other /project/ address (the hand-off address the holding page answers, an unsupported one).
    '/project/github.com/o',
    '/project/github.com/o/r/blob/main/x',
    '/project',
    // The old addresses of a GitHub project and of the GitHub store.
    '/store/github.com/project/datatug-demo-projects@datatug@demo-project-1',
    '/store/github.com/project/r@o@/chat',
    '/store/github/project/r@o',
    '/store/github.com',
    '/store/github',
  ])('%s has no agent', (path) => {
    expect(agentBaseUrlOfPath(path)).toBe(NO_AGENT_BASE_URL);
  });

  it('never gives a GitHub project the default local agent', () => {
    for (const path of [
      '/project/github.com/datatug/chinook-demo',
      '/project/github.com/o/r/tree/HEAD/d/-/chat',
      '/store/github.com/project/r@o@',
    ]) {
      expect(agentBaseUrlOfPath(path)).not.toContain('localhost');
    }
  });

  it('names the GitHub store as the library does (it is written out here to keep the initial bundle small)', () => {
    expect(GITHUB_STORE_IDS).toEqual([GITHUB_STORE_ID, 'github']);
  });

  it('has an address no request can reach, and not an empty one (the semantic client needs a non-empty base)', () => {
    expect(NO_AGENT_BASE_URL).not.toBe('');
    expect(new URL(NO_AGENT_BASE_URL).protocol).toBe('about:');
  });
});
