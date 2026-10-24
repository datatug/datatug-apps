// Load the component graph of the prebuilt @sneat packages before any spec runs. The datatug-main `test` target
// shares one module graph per worker, and Angular's JIT gives an already-used base class (SneatBaseComponent) an
// accessor-only `ɵfac`. A prebuilt subclass first evaluated after that does `static { this.ɵfac = ... }` and throws
// "Cannot set property ɵfac of class SneatBaseComponent ... which has only a getter". Which spec file hit it
// depended on how files were spread over workers, so it flaked. Evaluating the subclasses here, once per worker,
// makes every class definition happen before any spec can compile its base.
// The testing import comes first: it loads @angular/compiler, which the JIT needs when the components load.
import { setupTestEnvironment } from '@sneat/core/testing';
import '@sneat/ui';
import '@sneat/components';
import '@sneat/auth-ui';
import '@sneat/app-auth';
import '@sneat/grid';
import '@sneat/datagrid';
import '@sneat/datatug-semantic';

setupTestEnvironment();

// The GitHub reader remembers the anonymous rate limit (localStorage) and conditional answers (sessionStorage) across
// page loads; spec files share one module graph and one storage per worker, so each case starts with none.
import { beforeEach } from 'vitest';
import { clearStoredGithubApiMemory } from './lib/services/repo/github/github-api-memory';
beforeEach(() => clearStoredGithubApiMemory());
