import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { datatugDemoConfig as devConfig } from '../environments/environment';
import { datatugDemoConfig as prodConfig } from '../environments/environment.prod';
import { datatugDemoConfig as ssoConfig } from '../environments/environment.sso-e2e';
import { handoffDecision } from './demo-handoff-asked';
import { isTrustedHandoff, isHandoffPath } from './demo-handoff-capture';
import { routeSegments } from './demo-handoff-path';
import {
  DEMO_ENABLED_OVERRIDE_KEY,
  isDemoEnabled,
  resolveDemoEnabled,
} from './demo-flag';

const here = (...parts: string[]) => join(__dirname, ...parts);
const read = (path: string) => readFileSync(path, 'utf8');
/** A source file without its comments: comments say what is NOT read, only code counts. */
const code = (path: string) =>
  read(path)
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

interface HappyDomWindow {
  happyDOM: { setURL(url: string): void };
}

describe('the demo flag (G-F1)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    (window as unknown as HappyDomWindow).happyDOM.setURL(
      'https://datatug.app/',
    );
  });
  afterEach(() => window.localStorage.clear());

  describe('per environment', () => {
    it('is OFF in production', () => {
      expect(prodConfig.enabled).toBe(false);
      expect(typeof prodConfig.enabled).toBe('boolean');
    });
    it('is OFF in the SSO end-to-end build, the only other environment that is built', () => {
      expect(ssoConfig.enabled).toBe(false);
    });
    it('is ON only in development, which is never deployed', () => {
      expect(devConfig.enabled).toBe(true);
    });
    it('is exported by every environment file', () => {
      const dir = here('..', 'environments');
      for (const file of [
        'environment.ts',
        'environment.prod.ts',
        'environment.sso-e2e.ts',
      ])
        expect(read(join(dir, file)), file).toMatch(
          /export const datatugDemoConfig: DatatugDemoConfig = \{\s*enabled: (true|false),?\s*\};/,
        );
    });
    it('the production build deploys environment.prod.ts, not the development file', () => {
      const project = JSON.parse(read(here('..', '..', 'project.json')));
      const production = project.targets.build.configurations.production;
      expect(production.fileReplacements).toContainEqual({
        replace: 'apps/datatug-app/src/environments/environment.ts',
        with: 'apps/datatug-app/src/environments/environment.prod.ts',
      });
      expect(project.targets.build.defaultConfiguration).toBe('production');
    });
  });

  describe('resolveDemoEnabled', () => {
    it.each([
      // built, override, expected
      [false, undefined, false],
      [true, undefined, true],
      [false, null, false],
      [false, '1', true],
      [true, '1', true],
      [true, '0', false],
      [false, '0', false],
      // anything else is no opinion
      [false, '', false],
      [false, 'true', false],
      [false, 'yes', false],
      [false, ' 1', false],
      [false, '1 ', false],
      [false, '01', false],
      [false, 'on', false],
      [true, 'false', true],
      [true, 'off', true],
      [true, ' 0', true],
      [true, '', true],
    ])('built=%s, override=%j -> %s', (built, override, expected) => {
      expect(resolveDemoEnabled(built, override)).toBe(expected);
    });
  });

  describe('isDemoEnabled in this browser', () => {
    it('follows the build when nothing is stored: off in production', () => {
      expect(isDemoEnabled(prodConfig.enabled)).toBe(false);
    });
    it("'1' in localStorage turns it on in a build that has it off", () => {
      window.localStorage.setItem(DEMO_ENABLED_OVERRIDE_KEY, '1');
      expect(isDemoEnabled(prodConfig.enabled)).toBe(true);
    });
    it("'0' in localStorage forces it off in a build that has it on", () => {
      window.localStorage.setItem(DEMO_ENABLED_OVERRIDE_KEY, '0');
      expect(isDemoEnabled(true)).toBe(false);
      expect(isDemoEnabled(devConfig.enabled)).toBe(false);
    });
    it('the key is exactly datatug.demo.enabled', () => {
      expect(DEMO_ENABLED_OVERRIDE_KEY).toBe('datatug.demo.enabled');
      window.localStorage.setItem('datatug.demo.enabled ', '1');
      window.localStorage.setItem('Datatug.demo.enabled', '1');
      expect(isDemoEnabled(false)).toBe(false);
    });
    it('is not taken from sessionStorage', () => {
      window.sessionStorage.setItem(DEMO_ENABLED_OVERRIDE_KEY, '1');
      expect(isDemoEnabled(false)).toBe(false);
      window.sessionStorage.clear();
    });
    it('blocked storage is no override, not an error', () => {
      const blocked = () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      };
      expect(isDemoEnabled(false, blocked)).toBe(false);
      expect(isDemoEnabled(true, blocked)).toBe(true);
    });
    it('defaults to this build and this browser', () => {
      // The spec build is the development configuration (environment.ts): on, unless the browser says '0'.
      expect(isDemoEnabled()).toBe(devConfig.enabled);
      window.localStorage.setItem(DEMO_ENABLED_OVERRIDE_KEY, '0');
      expect(isDemoEnabled()).toBe(false);
    });
  });

  describe('no query parameter, fragment, cookie, name or project file can set it', () => {
    const KEY = DEMO_ENABLED_OVERRIDE_KEY;
    const ADDRESSES = [
      `/?${KEY}=1`,
      `/?demo=1&enabled=1&${KEY}=1`,
      `/#${KEY}=1`,
      `/?${KEY}=1#${KEY}=1`,
      `/demo?${KEY}=1`,
      `/project/github.com/datatug/chinook-demo/chat?${KEY}=1&msg=hi`,
      `/project/github.com/datatug/chinook-demo/chat?msg=hi#${KEY}=1`,
      `/?datatug.demo.enabled=true&demo.enabled=1&demo=on&flag=1`,
    ];

    it.each(ADDRESSES)('%s leaves a production build off', (address) => {
      (window as unknown as HappyDomWindow).happyDOM.setURL(
        'https://datatug.app' + address,
      );
      expect(isDemoEnabled(prodConfig.enabled)).toBe(false);
      expect(window.localStorage.getItem(KEY)).toBeNull();
    });

    it.each(ADDRESSES)(
      '%s does not force a development build off either',
      (address) => {
        (window as unknown as HappyDomWindow).happyDOM.setURL(
          'https://datatug.app' + address.replace('=1', '=0'),
        );
        expect(isDemoEnabled(true)).toBe(true);
      },
    );

    it('a cookie, window.name and sessionStorage do not set it', () => {
      document.cookie = `${KEY}=1`;
      const previousName = window.name;
      window.name = `${KEY}=1`;
      window.sessionStorage.setItem(KEY, '1');
      try {
        expect(isDemoEnabled(false)).toBe(false);
      } finally {
        document.cookie = `${KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        window.name = previousName;
        window.sessionStorage.clear();
      }
    });

    it('the source of the flag reads localStorage and nothing else: no address, cookie, name, network or project file', () => {
      const source = code(here('demo-flag.ts'));
      for (const forbidden of [
        /\blocation\b/,
        /URLSearchParams/,
        /\.search\b/,
        /\.hash\b/,
        /\.href\b/,
        /document\./,
        /window\.name/,
        /sessionStorage/,
        /\bfetch\b/,
        /XMLHttpRequest/,
        /\bimport\s*\(/,
        /readFile/,
        /@sneat\//,
      ])
        expect(source, String(forbidden)).not.toMatch(forbidden);
      expect(source.match(/localStorage/g)).toHaveLength(1);
      expect(source).toMatch(
        /import \{ datatugDemoConfig \} from '\.\.\/environments\/environment';/,
      );
    });

    it('takes no argument a project could fill: only the build value and a storage accessor', () => {
      expect(isDemoEnabled.length).toBe(0); // both parameters have defaults
      expect(resolveDemoEnabled.length).toBe(2);
    });
  });

  describe('trust is decided independently of the flag', () => {
    const PATHS = [
      '/demo',
      '/Demo',
      '/demo;x=1',
      '/project/github.com/datatug/chinook-demo/chat',
      '/project/github.com/Datatug/Chinook-Demo/chat',
      '/project/github.com/datatug/chinook-demo/tree/HEAD/-/chat',
      '/project/github.com/datatug/chinook-demo/tree/abc123/-/chat',
      '/project/github.com/datatug/chinook-demo/start-chat',
      '/project/github.com/datatug/chinook-demo/tree/abc123/-/start-chat',
      '/project/github.com/someone/else/start-chat',
      '/project/github.com/datatug/chinook-demo-evil/chat',
      '/project/github.com/someone/else/chat',
      '/store/x/project/y/chat',
      '/',
    ];
    const answers = (p: string) => [
      isTrustedHandoff(p),
      isHandoffPath(p),
      // which page a hand-off address gets is not the flag's either (it is decided by whether a question was asked)
      handoffDecision(routeSegments(p)),
    ];
    const baseline = PATHS.map(answers);

    it.each([[undefined], ['1'], ['0'], ['junk']])(
      'the answers for every path are the same with the override at %j',
      (override) => {
        if (override !== undefined)
          window.localStorage.setItem(DEMO_ENABLED_OVERRIDE_KEY, override);
        expect(PATHS.map(answers)).toEqual(baseline);
      },
    );

    it('the trust and hand-off code does not import the flag, and the flag does not import it', () => {
      for (const file of [
        'demo-handoff-capture.ts',
        'demo-handoff-asked.ts',
        'demo-handoff-path.ts',
        'demo-holding-page.component.ts',
        'datatug-app-routes.ts',
      ].filter((f) => existsSync(here(f))))
        expect(code(here(file)), file).not.toMatch(
          /demo-flag|datatugDemoConfig|datatug\.demo\.enabled/,
        );
      expect(code(here('demo-flag.ts'))).not.toMatch(/demo-handoff/);
    });
  });
});
