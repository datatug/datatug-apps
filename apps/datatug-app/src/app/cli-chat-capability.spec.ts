import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureCliChatCapability,
  cliChatCapability,
} from './cli-chat-capability';

// G-A1c (design `demo-as-github-project.md` 3.4, `cli-chat-capability.ts:4`): the regular expression for the CLI
// bridge's chat path is for CLI agents only (`/store/<id>/project/<id>/chat`) and is left as it is. The short
// address of a GitHub project must not match it: no capability is taken from, or kept for, a GitHub project's chat.
describe('captureCliChatCapability (the CLI bridge chat path)', () => {
  const capability = 'h=secret-capability';

  beforeEach(() => {
    sessionStorage.clear();
    delete document.documentElement.dataset['cliChatBridgePath'];
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    sessionStorage.clear();
  });

  const visit = (path: string) => {
    window.history.replaceState({}, '', `${path}#${capability}`);
    captureCliChatCapability();
  };

  it.each([
    '/store/localhost:8989/project/p1/chat',
    '/store/http-127.0.0.1:3284/project/demo-project-1/chat',
    '/chat',
  ])(
    'takes the capability of the CLI chat path %s out of the address',
    (path) => {
      visit(path);
      expect(window.location.hash).toBe('');
      expect(cliChatCapability()).toBe(capability);
    },
  );

  it('marks the CLI project chat path for the project menu', () => {
    visit('/store/localhost:8989/project/p1/chat');
    expect(document.documentElement.dataset['cliChatBridgePath']).toBe(
      '/store/localhost:8989/project/p1/chat',
    );
  });

  it.each([
    // The short address of a GitHub project, and its look-alikes: not a CLI chat path.
    '/project/github.com/datatug/chinook-demo/chat',
    '/project/github.com/o/r/tree/HEAD/d/-/chat',
    '/project/github.com/o/r/chat',
    '/project/p1/chat',
    '/store/github.com/project/r@o@/chat/extra',
    '/store/localhost:8989/project/p1/queries',
    '/store/localhost:8989/project/p1/chat/extra',
    '/project/localhost:8989/p1/chat',
  ])(
    'does not match %s: the address is left as it is and no capability is kept',
    (path) => {
      visit(path);
      expect(window.location.hash).toBe(`#${capability}`);
      expect(cliChatCapability()).toBe('');
      expect(sessionStorage.length).toBe(0);
      expect(
        document.documentElement.dataset['cliChatBridgePath'],
      ).toBeUndefined();
    },
  );
});
