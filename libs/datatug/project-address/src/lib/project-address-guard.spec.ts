// The regression guard of design `demo-as-github-project.md` 3.4, point 3 (task G-A1c): one place knows the shapes of
// a project address, and no third shape exists.
//
//   1. the short and the old spelling of one project resolve to the same `{storeId, projectId}` and page;
//   2. `projectUrl` writes one of two shapes only, and `parseProjectUrl` reads nothing else;
//   3. no source file builds or parses a project path by hand: a scan of the app's and its libraries' sources, by
//      content, fails when a construction of `/store/<id>/project/<id>` or of `/project/github.com/…` appears
//      anywhere but in `project-url.ts`, or a GitHub project id is joined or split with `@` outside
//      `github-project-address.ts`. (The old address redirecting to the short one is task G-A1d, held until the
//      founder answers question 6; its test belongs to that task.)
//
// Not a spec of behaviour that has a better home: when a new site is correct for a reason this scan cannot see, it
// is added to ALLOWED below with that reason, never silently.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProjectUrl, projectUrl, tryProjectUrl } from './project-url';

describe('one project, two spellings, one {storeId, projectId} (design 3.4 point 3)', () => {
  it.each([
    // [short spelling, old spelling]
    [
      '/project/github.com/datatug/chinook-demo',
      '/store/github.com/project/chinook-demo@datatug@',
    ],
    [
      '/project/github.com/datatug/chinook-demo/chat',
      '/store/github.com/project/chinook-demo@datatug@/chat',
    ],
    [
      '/project/github.com/o/r/tree/HEAD/demo-project-1/-/queries/a',
      '/store/github.com/project/r@o@demo-project-1/queries/a',
    ],
    [
      '/project/github.com/o/r/tree/HEAD/datatug/-/chat',
      '/store/github.com/project/r@o/chat',
    ],
    ['/project/github.com/o/r/tree/HEAD/datatug', '/store/github/project/r@o'],
    [
      '/project/github.com/o/r/tree/v1.0.0/-/chat',
      '/store/github.com/project/r@o@@v1.0.0/chat',
    ],
  ])('%s and %s are the same project and page', (short, old) => {
    const a = parseProjectUrl(short);
    const b = parseProjectUrl(old);
    expect(a).toMatchObject({ ok: true, shape: 'short', isCanonical: true });
    expect(b).toMatchObject({ ok: true, shape: 'legacy' });
    if (!a.ok || !b.ok) {
      throw new Error('not accepted');
    }
    expect({
      storeId: b.storeId,
      projectId: b.projectId,
      rest: b.rest,
    }).toEqual({
      storeId: a.storeId,
      projectId: a.projectId,
      rest: a.rest,
    });
    // The old spelling's one canonical address is the short one.
    expect(b.canonicalPath).toBe(a.canonicalPath);
    expect(b.isCanonical).toBe(false);
  });

  it.each([
    // [store id, project id, page]: every other store has exactly one shape, the old one.
    ['localhost:8989', 'datatug-demo-project', 'queries'],
    ['http-localhost:8989', 'p1', undefined],
    ['https-agent.example.com', 'p1', 'entities'],
    ['firestore', 'abc123', 'chat'],
  ])('%s project %s has the old shape only', (storeId, projectId, page) => {
    const path = projectUrl({ storeId, projectId }, page);
    expect(path).toBe(
      `/store/${storeId}/project/${projectId}${page ? '/' + page : ''}`,
    );
    expect(parseProjectUrl(path)).toMatchObject({
      ok: true,
      shape: 'legacy',
      isCanonical: true,
      storeId,
      projectId,
    });
  });
});

describe('no third shape of a project address exists (design 3.4 point 3)', () => {
  it.each([
    '/project/chinook-demo@datatug@',
    '/project/github.com',
    '/project/github.com/o',
    '/project/localhost:8989/p1',
    '/project/localhost:8989/p1/chat',
    '/projects/github.com/o/r',
    '/store/localhost:8989/projects/p1',
    '/pwa/repo/r/agent/a1',
    '/agent/a1/project/p1',
    '/github.com/o/r',
    '/o/r',
    '/store/localhost:8989',
    '/',
    '',
  ])('%j is no project address', (path) => {
    expect(parseProjectUrl(path)).toMatchObject({ ok: false });
  });

  it('writes only the short GitHub shape and the old shape, for every project it writes', () => {
    const projects = [
      ['github.com', 'r@o@'],
      ['github', 'r@o'],
      ['github.com', 'r@o@d@v1'],
      ['localhost:8989', 'p'],
      ['http-localhost:8989', 'p'],
      ['firestore', 'p'],
    ];
    for (const [storeId, projectId] of projects) {
      for (const page of [undefined, 'chat', ['query', 'a/b'], 'tree/x']) {
        const path = tryProjectUrl({ storeId, projectId }, page);
        expect(typeof path).toBe('string');
        expect(path as string).toMatch(
          /^\/(?:project\/github\.com\/[^/]+\/[^/]+|store\/[^/]+\/project\/[^/]+)(?:\/|$)/,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/** Sources that may build or parse a project path: the library itself, whose job it is. */
const OWNERS = ['libs/datatug/project-address/'];

/** What a hand-built project path, a regular expression over one, or a GitHub project id join looks like. */
const SHAPES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'a template literal `/store/${…}`', pattern: /`\/?store\/\$\{/ },
  { name: "a concatenation '/store/' + …", pattern: /['"]\/?store\/['"]\s*\+/ },
  { name: 'a template interpolation /store/{{ … }}', pattern: /\/store\/\{\{/ },
  {
    name: "a router command array ['store', …, 'project', …]",
    pattern: /['"]\/?store['"]\s*,[^;]{0,160}?['"]project['"]/,
  },
  { name: 'a template literal `/project/${…}`', pattern: /`\/?project\/\$\{/ },
  {
    name: "a concatenation 'project/' + …",
    pattern: /['"]\/?project\/['"]\s*\+/,
  },
  {
    name: 'a regular expression over /store/ or /project/',
    pattern: /\\\/(?:store|project)\\\//,
  },
  { name: "a split of a GitHub project id at '@'", pattern: /\.split\('@'\)/ },
  {
    name: 'a join of repo and owner with @',
    pattern: /\$\{[^}]*(?:repo|repository)[^}]*\}@\$\{[^}]*(?:org|owner)/i,
  },
];

/** Files where a match is right, and why. Each must still match (so this list cannot go stale). */
const ALLOWED: Readonly<Record<string, string>> = {
  'apps/datatug-app/src/app/cli-chat-capability.ts':
    "the CLI bridge's chat path is for CLI agents only (/store/<id>/project/<id>/chat), left as it is on purpose (G-A1c); cli-chat-capability.spec.ts proves the short address does not match it",
  'libs/datatug/main/src/lib/pages/signed-in/environment/environment-page.component.ts':
    'writes the address of a STORE page (/store/<id>), the back button of the environment page, not of a project',
  'libs/datatug/main/src/lib/pages/signed-in/project/project-page.component.html':
    'writes the address of a STORE page (/store/<id>), the back button of the project page, not of a project',
};

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) {
      continue;
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourcesUnder(path));
    } else if (
      /\.(ts|html)$/.test(name) &&
      !/\.(spec|test)\.ts$/.test(name) &&
      !/\.d\.ts$/.test(name)
    ) {
      out.push(path);
    }
  }
  return out;
}

/** Comments never build a path: a line comment (after a space or at the start of the line) and a block comment. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function scanned(): { file: string; shapes: string[] }[] {
  const dirs = [
    join(ROOT, 'apps/datatug-app/src'),
    ...readdirSync(join(ROOT, 'libs/datatug'))
      .map((name) => join(ROOT, 'libs/datatug', name, 'src'))
      .filter((dir) => {
        try {
          return statSync(dir).isDirectory();
        } catch {
          return false;
        }
      }),
  ];
  return dirs
    .flatMap(sourcesUnder)
    .map((path) => relative(ROOT, path).split('\\').join('/'))
    .filter((file) => !OWNERS.some((owner) => file.startsWith(owner)))
    .map((file) => {
      const source = withoutComments(readFileSync(join(ROOT, file), 'utf8'));
      return {
        file,
        shapes: SHAPES.filter((s) => s.pattern.test(source)).map((s) => s.name),
      };
    });
}

describe('no source builds or parses a project path by hand (design 3.4 point 3)', () => {
  const files = scanned();

  it('scans the sources of the app and of every library (a scan of nothing proves nothing)', () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files.some((f) => f.file === 'apps/datatug-app/src/main.ts')).toBe(
      true,
    );
    expect(
      files.some(
        (f) =>
          f.file ===
          'libs/datatug/main/src/lib/services/nav/datatug-nav.service.ts',
      ),
    ).toBe(true);
    expect(
      files.some((f) => f.file.startsWith('libs/datatug/project-address/')),
    ).toBe(false);
  });

  it('finds every shape in a sample (the patterns are not vacuous)', () => {
    const samples = [
      '`/store/${s}/project/${p}`',
      "'/store/' + s",
      'defaultHref="/store/{{ s }}/project/{{ p }}"',
      "['store', storeId,\n 'project', id]",
      '`/project/${id}/x`',
      "'project/' + id",
      'location.pathname.match(/\\/store\\/([^/]+)/)',
      "id.split('@')",
      '`${project.repo}@${project.org}@${folder}`',
    ];
    for (const sample of samples) {
      expect(SHAPES.some((s) => s.pattern.test(sample))).toBe(true);
    }
    for (const sample of SHAPES.map((s) => s.name)) {
      expect(
        samples.some((text) =>
          SHAPES.find((s) => s.name === sample)?.pattern.test(text),
        ),
      ).toBe(true);
    }
  });

  it('finds none outside the allowed files', () => {
    const found = files
      .filter((f) => f.shapes.length > 0 && !(f.file in ALLOWED))
      .map((f) => `${f.file}: ${f.shapes.join('; ')}`);
    expect(found).toEqual([]);
  });

  it('keeps the allowed files honest: each still holds what it is allowed for', () => {
    for (const file of Object.keys(ALLOWED)) {
      const hit = files.find((f) => f.file === file);
      expect(hit, `${file} is scanned`).toBeDefined();
      expect(
        hit?.shapes.length,
        `${file} still matches a shape`,
      ).toBeGreaterThan(0);
    }
  });
});
