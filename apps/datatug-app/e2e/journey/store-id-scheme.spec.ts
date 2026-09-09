import { expect, test } from './fixtures/agent-server';

/**
 * S33 — the web UI must reach a local agent through the scheme-carrying
 * store id `datatug serve` actually prints (datatug-cli PR #198:
 * `https://datatug.app/store/http-<host>:<port>`), not just the bare
 * `host:port` form J1 (./journey.spec.ts) happens to use.
 *
 * This is a separate spec file, not an addition to journey.spec.ts, per
 * this stream's brief (journey.spec.ts and the app's auth guards are owned
 * by lane S30's sign-in-gating fix). It reuses the `agentServer` fixture
 * unmodified — `agentServer.host`/`.port` are enough to build the
 * `http-<host>:<port>` id, so no fixture extension was needed.
 *
 * Asserts the MECHANISM: the actual URL of the first request the app sends
 * to the agent, observed via Playwright's request event
 * (`page.waitForRequest`). This *observes* the real request; it never
 * routes or stubs it, so it stays inside this suite's "no interception of
 * the backend" rule (see ./README.md) — the same rule journey.spec.ts's own
 * top comment cites for why this whole project exists. Checking only the
 * rendered outcome (e.g. that projects eventually appear) would not catch
 * the actual bug this stream fixed: `parseDatatugStoreRef()`
 * (`libs/datatug/main/src/lib/nav/nav-models.ts`) used to return the raw,
 * unconverted id (`"http-127.0.0.1:PORT"`, no `://`) for this exact
 * `http-<host>:<port>` form, because it has a port and its regex
 * short-circuit didn't exclude the `http-`/`https-` prefix. That specific
 * bug never broke `buildAgentUrl()` (`services/repo/agent-url.ts` calls
 * `getStoreUrl()` directly on the raw storeId, which already handles the
 * prefix correctly) or the page's requests — so a request-level assertion
 * is what actually exercises the code path this stream changed
 * (`storeIdToDisplayLabel`'s use of the same `parseDatatugStoreRef`, and
 * `DatatugNavService.goStore()`'s round trip back to this id) rather than
 * re-proving something that already worked.
 */
test.describe('web UI reaches a local agent through the http-<host>:<port> store id', () => {
  test('navigating to /store/http-<host>:<port> sends its first agent request to http://<host>:<port>/datatug/...', async ({
    agentServer,
    page,
  }) => {
    const storeId = `http-${agentServer.host}:${agentServer.port}`;
    const expectedOrigin = `http://${agentServer.host}:${agentServer.port}`;

    const firstAgentRequest = page.waitForRequest(
      (request) => request.url().startsWith(`${expectedOrigin}/datatug/`),
      { timeout: 15_000 },
    );

    // "the browser opens the store page for the agent's http-<host>:<port>
    // link" — the exact link `datatug serve` prints, real navigation, no
    // interception (mirrors J1's own navigation style in journey.spec.ts).
    await page.goto(`/store/${storeId}`);

    const request = await firstAgentRequest;

    // Mechanism, not outcome: the request actually reached the agent's real
    // scheme+host+port, under the /datatug prefix every CLI agent route is
    // registered under (see agent-url.ts's AGENT_API_PATH_PREFIX comment).
    expect(request.url()).toMatch(
      new RegExp(
        `^${expectedOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/datatug/`,
      ),
    );

    // Belt-and-suspenders: the pre-fix bug shape was the raw, unconverted
    // "http-<host>:<port>" id leaking verbatim into a request URL (a
    // guaranteed connection failure — no such host). The startsWith()
    // assertion above already rules this out; this documents why.
    expect(request.url()).not.toContain('http-');

    // The agent's own request log corroborates the same request landed
    // under /datatug/, the same way J1 checks it in journey.spec.ts.
    await expect
      .poll(() => agentServer.readLog(), { timeout: 15_000 })
      .toMatch(/\/datatug\//);
  });
});
