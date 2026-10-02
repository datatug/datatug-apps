import * as Sentry from '@sentry/browser';
import { datatugAppEnvironmentConfig } from '../environments/environment.prod';

// Separate file: Sentry instruments the page's history once per module instance and remembers the URL it saw
// first, so this deliberately leaking run must not share a module registry with demo-handoff-reporting.spec.ts.
const MARKER = 'ZEBRA-SECRET-QUESTION-7731';

it('control: without the capture the same Sentry setup does report the question, so the detector in demo-handoff-reporting.spec.ts is not blind', async () => {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(`https://datatug.app/demo?q=${MARKER}`);
  const sent: unknown[] = [];
  Sentry.init({
    ...datatugAppEnvironmentConfig.sentry,
    transport: () => ({
      send: async (envelope) => {
        sent.push(envelope);
        return {};
      },
      flush: async () => true,
    }),
  });
  Sentry.captureException(new Error('boom'));
  await Sentry.flush(2000);
  await Sentry.close(2000);
  expect(JSON.stringify(sent)).toContain(MARKER);
});
