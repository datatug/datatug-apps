// After a deploy: demo.datatug.app answers with the redirect to datatug.app/demo, path and query kept.
// A new custom domain's DNS record and certificate can take a few minutes, so this retries for up to 5 minutes.
const FROM = 'https://demo.datatug.app/smoke?utm_source=deploy';
const TO = 'https://datatug.app/demo/smoke?utm_source=deploy';
const deadline = Date.now() + 5 * 60_000;

let last = '';
while (Date.now() < deadline) {
  try {
    const response = await fetch(FROM, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status === 302 && location === TO) {
      console.log(`ok: ${FROM} -> ${response.status} ${location}`);
      process.exit(0);
    }
    last = `${response.status} ${location ?? '(no location)'}`;
  } catch (error) {
    last = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
console.error(`::error title=demo.datatug.app redirect smoke failed::expected 302 ${TO}, last answer: ${last}`);
process.exit(1);
