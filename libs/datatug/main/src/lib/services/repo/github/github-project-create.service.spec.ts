import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SneatApiService } from '@sneat/api';
import { ErrorLogger } from '@sneat/core';
import { of, throwError } from 'rxjs';

import { DatatugStoreGithubService } from '../datatug-store.service.github';
import { GithubRepoError } from './github-api';
import { GithubProjectReaderService } from './github-project-reader.service';
import {
  DEFAULT_GITHUB_PROJECT_FOLDER,
  GithubProjectCreateService,
  GITHUB_PROJECT_FILE_NAME,
  GITHUB_PROJECT_README,
  parseGithubRepo,
  REGISTER_GITHUB_PROJECT_ENDPOINT,
} from './github-project-create.service';

const TOKEN = 'ghp_test_token';
const REPO_URL = 'https://api.github.com/repos/datatug/demo-projects';
const REPO_CONTENTS_URL = `${REPO_URL}/contents`;

describe('parseGithubRepo', () => {
  it('parses owner/name', () => {
    expect(parseGithubRepo('datatug/demo-projects')).toEqual({
      org: 'datatug',
      repo: 'demo-projects',
    });
  });

  it('accepts a clone URL, with or without a trailing .git', () => {
    expect(
      parseGithubRepo('https://github.com/datatug/demo-projects.git'),
    ).toEqual({ org: 'datatug', repo: 'demo-projects' });
  });

  it('rejects anything that is not exactly owner/name', () => {
    for (const value of ['', 'datatug', 'datatug/', '/demo', 'a/b/c']) {
      expect(parseGithubRepo(value)).toBeUndefined();
    }
  });
});

describe('GithubProjectCreateService', () => {
  let service: GithubProjectCreateService;
  let httpMock: HttpTestingController;
  let sneatApi: { post: ReturnType<typeof vi.fn> };
  /** Everything the service did after the files were committed, in order. */
  let events: string[];
  let reader: { forget: ReturnType<typeof vi.fn> };
  let summaries: { forget: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    events = [];
    reader = {
      forget: vi.fn(() => {
        events.push('reader.forget');
        return Promise.resolve();
      }),
    };
    summaries = {
      forget: vi.fn(() => {
        events.push('summaries.forget');
      }),
    };
    sneatApi = {
      post: vi.fn(() => {
        events.push('register');
        return of({ id: 'demo-projects@datatug@datatug' });
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SneatApiService, useValue: sneatApi },
        { provide: GithubProjectReaderService, useValue: reader },
        { provide: DatatugStoreGithubService, useValue: summaries },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
    });
    service = TestBed.inject(GithubProjectCreateService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  interface IPutFileBody {
    message: string;
    content: string;
    branch: string;
    sha?: string;
  }

  /** The repository, as GitHub answers it: the service asks which branch is the default before it commits. */
  const answerRepo = (defaultBranch = 'main'): void => {
    const get = httpMock.expectOne((r) => r.method === 'GET' && r.url === REPO_URL);
    expect(get.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    get.flush({ full_name: 'datatug/demo-projects', default_branch: defaultBranch });
  };

  /**
   * The service reads a file before writing it (GitHub needs the current blob's
   * sha to update one), so each write is a GET followed by a PUT.
   */
  const createFile = (
    path: string,
    existingSha?: string,
    branch = 'main',
  ): { content: string } => {
    const url = `${REPO_CONTENTS_URL}/${path}`;
    const get = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === url,
    );
    expect(get.request.params.get('ref')).toBe(branch);
    if (existingSha) {
      get.flush({ sha: existingSha });
    } else {
      get.flush('Not Found', { status: 404, statusText: 'Not Found' });
    }
    const put = httpMock.expectOne((r) => r.method === 'PUT' && r.url === url);
    expect(put.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    const body = put.request.body as IPutFileBody;
    expect(body.branch).toBe(branch);
    expect(body.sha).toBe(existingSha);
    expect(body.message).toContain('My project');
    put.flush({});
    return { content: atob(body.content) };
  };

  /** The service waits for the reader to forget the repository (a promise) before it goes on. */
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it('commits the readme and the project file, then resolves with the project ref', async () => {
    let projectRef: unknown;
    service
      .createProject({
        org: 'datatug',
        repo: 'demo-projects',
        title: 'My project',
        folder: 'my-folder',
      }, TOKEN)
      .subscribe((ref) => (projectRef = ref));

    answerRepo();
    expect(createFile('my-folder/README.md').content).toBe(
      GITHUB_PROJECT_README,
    );
    const projectFile = JSON.parse(
      createFile(`my-folder/${GITHUB_PROJECT_FILE_NAME}`).content,
    ) as {
      title: string;
      access: string;
      created: { at: string };
    };
    expect(projectFile.title).toBe('My project');
    expect(projectFile.access).toBe('private');
    expect(Number.isNaN(Date.parse(projectFile.created.at))).toBe(false);

    await settle();
    expect(projectRef).toEqual({
      repo: 'demo-projects',
      org: 'datatug',
      folder: 'my-folder',
    });
    // ...and the cloud is told about the project so it shows up in the list.
    expect(sneatApi.post).toHaveBeenCalledWith(REGISTER_GITHUB_PROJECT_ENDPOINT, {
      org: 'datatug',
      repo: 'demo-projects',
      folder: 'my-folder',
      title: 'My project',
    });
  });

  it('still succeeds when registering the project in the index fails', async () => {
    sneatApi.post.mockReturnValue(throwError(() => new Error('500')));
    const refs: unknown[] = [];
    service
      .createProject({
        org: 'datatug',
        repo: 'demo-projects',
        title: 'My project',
      }, TOKEN)
      .subscribe((ref) => refs.push(ref));
    answerRepo();
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/README.md`);
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/${GITHUB_PROJECT_FILE_NAME}`);
    await settle();
    expect(refs).toEqual([
      {
        repo: 'demo-projects',
        org: 'datatug',
        folder: DEFAULT_GITHUB_PROJECT_FOLDER,
      },
    ]);
  });

  it('defaults the folder to datatug and trims surrounding slashes', async () => {
    const refs: { folder: string }[] = [];
    service
      .createProject({
        org: 'datatug',
        repo: 'demo-projects',
        title: 'My project',
      }, TOKEN)
      .subscribe((ref) => refs.push(ref));
    answerRepo();
    expect(createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/README.md`)).toBeTruthy();
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/${GITHUB_PROJECT_FILE_NAME}`);
    await settle();
    expect(refs).toEqual([{ repo: 'demo-projects', org: 'datatug', folder: DEFAULT_GITHUB_PROJECT_FOLDER }]);

    service
      .createProject({
        org: 'datatug',
        repo: 'demo-projects',
        title: 'My project',
        folder: '/nested/',
      }, TOKEN)
      .subscribe((ref) => refs.push(ref));
    answerRepo();
    createFile('nested/README.md');
    createFile(`nested/${GITHUB_PROJECT_FILE_NAME}`);
    await settle();
    expect(refs[1]).toEqual({
      repo: 'demo-projects',
      org: 'datatug',
      folder: 'nested',
    });
  });

  it('sends the existing sha when the file is already there', () => {
    service
      .createProject({
        org: 'datatug',
        repo: 'demo-projects',
        title: 'My project',
      }, TOKEN)
      .subscribe();
    answerRepo();
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/README.md`, 'existing-sha');
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/${GITHUB_PROJECT_FILE_NAME}`);
  });

  it('commits to the default branch of the repository, whatever it is called (the reader reads HEAD)', async () => {
    const refs: unknown[] = [];
    service
      .createProject(
        { org: 'datatug', repo: 'demo-projects', title: 'My project' },
        TOKEN,
      )
      .subscribe((ref) => refs.push(ref));
    answerRepo('trunk');
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/README.md`, undefined, 'trunk');
    createFile(
      `${DEFAULT_GITHUB_PROJECT_FOLDER}/${GITHUB_PROJECT_FILE_NAME}`,
      undefined,
      'trunk',
    );
    await settle();
    expect(refs).toHaveLength(1);
  });

  it('commits nothing, and says why, when the repository cannot be read', () => {
    const errors: unknown[] = [];
    service
      .createProject(
        { org: 'datatug', repo: 'demo-projects', title: 'My project' },
        TOKEN,
      )
      .subscribe({ error: (e) => errors.push(e) });
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === REPO_URL)
      .flush('Not Found', { status: 404, statusText: 'Not Found' });
    expect(errors).toHaveLength(1);
    expect(reader.forget).not.toHaveBeenCalled();
    // `httpMock.verify()`: no file was read or written.
  });

  it('fails, and forgets nothing, when GitHub refuses to say whether a file is there', async () => {
    const errors: unknown[] = [];
    service
      .createProject(
        { org: 'datatug', repo: 'demo-projects', title: 'My project' },
        TOKEN,
      )
      .subscribe({ error: (e) => errors.push(e) });
    answerRepo();
    const lookups = httpMock.match(
      (r) => r.method === 'GET' && r.url.startsWith(REPO_CONTENTS_URL),
    );
    expect(lookups).toHaveLength(2);
    lookups[0].flush('boom', { status: 500, statusText: 'Server Error' });
    await settle();
    expect(errors).toHaveLength(1);
    expect(reader.forget).not.toHaveBeenCalled();
  });

  it('commits nothing when the answer is not a repository', () => {
    const errors: Error[] = [];
    service
      .createProject(
        { org: 'datatug', repo: 'demo-projects', title: 'My project' },
        TOKEN,
      )
      .subscribe({ error: (e) => errors.push(e) });
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === REPO_URL)
      .flush({});
    expect(errors.map((e) => e.message)).toEqual([
      'GitHub did not return the repository datatug/demo-projects',
    ]);
  });

  it('commits nothing when GitHub does not say which branch is the default one, and says so (no assumed main)', () => {
    const errors: Error[] = [];
    service
      .createProject(
        { org: 'datatug', repo: 'demo-projects', title: 'My project' },
        TOKEN,
      )
      .subscribe({ error: (e) => errors.push(e) });
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === REPO_URL)
      .flush({ full_name: 'datatug/demo-projects' });
    expect(errors.map((e) => e.message)).toEqual([
      'GitHub did not return the default branch of datatug/demo-projects, so DataTug cannot tell which branch to commit to.',
    ]);
    expect(errors[0]).toBeInstanceOf(GithubRepoError);
    httpMock.expectNone((r) => r.method === 'PUT');
  });

  it('once the files are committed, the reader and the summary service forget the repository, before the project is registered or opened', async () => {
    const seen: string[] = [];
    service
      .createProject(
        { org: 'datatug', repo: 'demo-projects', title: 'My project' },
        TOKEN,
      )
      .subscribe(() => seen.push(...events, 'emitted'));
    answerRepo();
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/README.md`);
    expect(events).toEqual([]); // not before the project file is committed too
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/${GITHUB_PROJECT_FILE_NAME}`);
    await settle();

    expect(reader.forget).toHaveBeenCalledWith('datatug', 'demo-projects');
    expect(summaries.forget).toHaveBeenCalledWith('datatug', 'demo-projects');
    // The reader forgets first (it must have dropped its memory before anyone reads again).
    expect(seen).toEqual([
      'reader.forget',
      'summaries.forget',
      'register',
      'emitted',
    ]);
  });

  it('forgets even when registering the project in the index fails', async () => {
    sneatApi.post.mockReturnValue(throwError(() => new Error('500')));
    service
      .createProject(
        { org: 'datatug', repo: 'demo-projects', title: 'My project' },
        TOKEN,
      )
      .subscribe();
    answerRepo();
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/README.md`);
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/${GITHUB_PROJECT_FILE_NAME}`);
    await settle();
    expect(reader.forget).toHaveBeenCalledTimes(1);
    expect(sneatApi.post).toHaveBeenCalledTimes(1);
  });

});
