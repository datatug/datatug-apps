# Demo e2e

Playwright project `demo`: the hand-off from datatug.ai (`/demo?scenario=&q=&lang=`) through the trace,
the grid and chart, the follow-up and a reload, against the **real local stack**: the demo project's OVDB
server and the dev web app. No interception of the data path; no third-party network.

```sh
pnpm demo:e2e            # start the stack (or attach), run this project, stop what it started
pnpm demo:up             # start it and keep it running, then:
DATATUG_E2E_PORT=4200 pnpm exec playwright test -c apps/datatug-app/playwright.config.ts --project=demo
```

Port: the web app must be on the port the OVDB CORS shim allows. `demo:e2e` sets both from `DEMO_WEB_PORT`
(default 4200), so the same value must be used for `demo:up` and the tests.

When the stack is not running the whole project is skipped with the command to start it.
Set `DEMO_SCREENSHOT_DIR=<dir>` to save screenshots at 390, 768 and 1440 wide, light and dark.
