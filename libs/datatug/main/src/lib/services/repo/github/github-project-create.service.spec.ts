import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SneatApiService } from '@sneat/api';
import { ErrorLogger } from '@sneat/core';
import { of, throwError } from 'rxjs';

import {
  DEFAULT_GITHUB_PROJECT_FOLDER,
  GithubProjectCreateService,
  GITHUB_PROJECT_BRANCH,
  GITHUB_PROJECT_FILE_NAME,
  GITHUB_PROJECT_README,
  parseGithubRepo,
  REGISTER_GITHUB_PROJECT_ENDPOINT,
} from './github-project-create.service';

const TOKEN = 'ghp_test_token';
const REPO_CONTENTS_URL =
  'https://api.github.com/repos/datatug/demo-projects/contents';

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

  beforeEach(() => {
    sneatApi = { post: vi.fn(() => of({ id: 'demo-projects@datatug@datatug' })) };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SneatApiService, useValue: sneatApi },
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

  /**
   * The service reads a file before writing it (GitHub needs the current blob's
   * sha to update one), so each write is a GET followed by a PUT.
   */
  const createFile = (
    path: string,
    existingSha?: string,
  ): { content: string } => {
    const url = `${REPO_CONTENTS_URL}/${path}`;
    const get = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === url,
    );
    expect(get.request.params.get('ref')).toBe(GITHUB_PROJECT_BRANCH);
    if (existingSha) {
      get.flush({ sha: existingSha });
    } else {
      get.flush('Not Found', { status: 404, statusText: 'Not Found' });
    }
    const put = httpMock.expectOne((r) => r.method === 'PUT' && r.url === url);
    expect(put.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    const body = put.request.body as IPutFileBody;
    expect(body.branch).toBe(GITHUB_PROJECT_BRANCH);
    expect(body.sha).toBe(existingSha);
    expect(body.message).toContain('My project');
    put.flush({});
    return { content: atob(body.content) };
  };

  it('commits the readme and the project file, then resolves with the project ref', () => {
    let projectRef: unknown;
    service
      .createProject({
        org: 'datatug',
        repo: 'demo-projects',
        title: 'My project',
        folder: 'my-folder',
      }, TOKEN)
      .subscribe((ref) => (projectRef = ref));

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

  it('still succeeds when registering the project in the index fails', () => {
    sneatApi.post.mockReturnValue(throwError(() => new Error('500')));
    const refs: unknown[] = [];
    service
      .createProject({
        org: 'datatug',
        repo: 'demo-projects',
        title: 'My project',
      }, TOKEN)
      .subscribe((ref) => refs.push(ref));
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/README.md`);
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/${GITHUB_PROJECT_FILE_NAME}`);
    expect(refs).toEqual([
      {
        repo: 'demo-projects',
        org: 'datatug',
        folder: DEFAULT_GITHUB_PROJECT_FOLDER,
      },
    ]);
  });

  it('defaults the folder to datatug and trims surrounding slashes', () => {
    const refs: { folder: string }[] = [];
    service
      .createProject({
        org: 'datatug',
        repo: 'demo-projects',
        title: 'My project',
      }, TOKEN)
      .subscribe((ref) => refs.push(ref));
    expect(createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/README.md`)).toBeTruthy();
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/${GITHUB_PROJECT_FILE_NAME}`);
    expect(refs).toEqual([{ repo: 'demo-projects', org: 'datatug', folder: DEFAULT_GITHUB_PROJECT_FOLDER }]);

    service
      .createProject({
        org: 'datatug',
        repo: 'demo-projects',
        title: 'My project',
        folder: '/nested/',
      }, TOKEN)
      .subscribe((ref) => refs.push(ref));
    createFile('nested/README.md');
    createFile(`nested/${GITHUB_PROJECT_FILE_NAME}`);
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
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/README.md`, 'existing-sha');
    createFile(`${DEFAULT_GITHUB_PROJECT_FOLDER}/${GITHUB_PROJECT_FILE_NAME}`);
  });

});
