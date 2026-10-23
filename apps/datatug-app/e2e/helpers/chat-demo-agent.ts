import type { Page } from '@playwright/test';

// These legacy Chat journeys execute Chinook in DALgo/IndexedDB. Supply their
// local agent's navigation metadata too, so an absent localhost agent does not
// cover the page header with unrelated connection-error toasts.
export async function chatDemoAgentMetadata(page: Page): Promise<void> {
  const project = { id: 'datatug-demo-project', title: 'Chat demo', environments: [] };
  await page.route('http://localhost:8989/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/projects/project_summary') || path.endsWith('/projects/project_full')) return route.fulfill({ json: project });
    if (path.endsWith('/projects/projects_summary')) return route.fulfill({ json: [project] });
    if (path.endsWith('/environments/all_environments')) return route.fulfill({ json: [] });
    if (path.endsWith('/agent-info')) return route.fulfill({ json: { version: '0.100.0' } });
    if (path.endsWith('/environments/state')) {
      return route.fulfill({ status: 404, contentType: 'text/plain', body: '404 page not found\n' });
    }
    return route.continue();
  });
}
