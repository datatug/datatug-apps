import { describe, expect, it, vi } from 'vitest';
import { readOvdbJsonRecordStream } from './ovdb-json-record-stream';

const encoder = new TextEncoder();

function streamed(parts: readonly string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/json' } });
}

describe('provider-neutral OVDB JSON result stream', () => {
  it('delivers records before the footer, across UTF-8, escape and nested-value boundaries', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
    const response = new Response(body, { headers: { 'Content-Type': 'application/json' } });
    const onRecord = vi.fn();
    const run = readOvdbJsonRecordStream(response, onRecord);
    const first = encoder.encode('{"records":[{"data":{"label":"caf\u00e9 \\"quoted\\"","nested":{"values":[1,true,null]}}}');
    const accent = first.indexOf(0xc3);
    source.enqueue(first.slice(0, accent + 1));
    source.enqueue(first.slice(accent + 1));
    await vi.waitFor(() => expect(onRecord).toHaveBeenCalledOnce());
    expect(onRecord.mock.calls[0][0].data).toEqual({ label: 'café "quoted"', nested: { values: [1, true, null] } });
    source.enqueue(encoder.encode(',{"data":{"label":"second"}}],"columns":["label","nested"],"execution":{"engine":"dalgo"},"complete":true}'));
    source.close();
    const result = await run;
    expect(result.rows).toBe(2);
    expect(result.footer.columns).toEqual(['label', 'nested']);
  });

  it('refuses a clean EOF without an affirmative terminal footer, even after a provisional row', async () => {
    for (const tail of ['', '],"columns":["id"]}', '],"columns":["id"],"complete":false}']) {
      const seen = vi.fn();
      await expect(readOvdbJsonRecordStream(streamed(['{"records":[{"data":{"id":1}}', tail]), seen)).rejects.toThrow();
      expect(seen).toHaveBeenCalledOnce();
    }
  });

  it('refuses lossy JSON numeric tokens while preserving quoted wide integers and decimals', async () => {
    const seen = vi.fn();
    await expect(readOvdbJsonRecordStream(streamed(['{"records":[{"data":{"id":9007199254740993}}],"columns":["id"],"complete":true}']), seen)).rejects.toThrow(/unquoted numeric/);
    expect(seen).not.toHaveBeenCalled();
    await readOvdbJsonRecordStream(streamed(['{"records":[{"data":{"id":"9007199254740993","amount":"1234567890.123456789"}}],"columns":["id","amount"],"execution":{},"complete":true}']), seen);
    expect(seen.mock.calls[0][0].data).toEqual({ id: '9007199254740993', amount: '1234567890.123456789' });
  });

  it('accepts the existing key-only simple DTQL record form without inventing fields', async () => {
    const rows: unknown[] = [];
    const result = await readOvdbJsonRecordStream(streamed(['{"records":[{"key":"k-1"}],"complete":true}']),
      (record) => { rows.push(record); });
    expect(rows).toEqual([{ key: 'k-1', data: {} }]);
    expect(result.rows).toBe(1);
    expect(result.footer.columns).toEqual([]);
  });

  it('derives simple-query columns only after completion and requires relational metadata', async () => {
    const simple = await readOvdbJsonRecordStream(streamed(['{"records":[{"key":"k","data":{"first":1}},{"key":"j","data":{"second":2}}],"complete":true}']), () => undefined);
    expect(simple.footer.columns).toEqual(['first', 'second']);
    await expect(readOvdbJsonRecordStream(streamed(['{"records":[{"data":{"id":1}}],"complete":true}']), () => undefined)).rejects.toThrow(/columns/);
  });

  it('requires commas exactly between records, even when the separator crosses chunks', async () => {
    for (const parts of [
      ['{"records":[', ',{"data":{}}],"columns":[],"execution":{},"complete":true}'],
      ['{"records":[{"data":{}}', '{"data":{}}],"columns":[],"execution":{},"complete":true}'],
      ['{"records":[{"data":{}}', ',],"columns":[],"execution":{},"complete":true}'],
    ]) {
      await expect(readOvdbJsonRecordStream(streamed(parts), vi.fn())).rejects.toThrow(/separator|record/);
    }
  });

  it('rejects missing columns and cumulative row/byte overruns without accepting a prefix', async () => {
    await expect(readOvdbJsonRecordStream(streamed(['{"records":[{"data":{"id":1}}],"columns":[],"complete":true}']), vi.fn())).rejects.toThrow(/columns/);
    await expect(readOvdbJsonRecordStream(streamed(['{"records":[{"data":{}},{"data":{}}],"columns":[],"complete":true}']), vi.fn(), undefined,
      { bytes: 1024, rows: 1, recordBytes: 1024, footerBytes: 1024 })).rejects.toThrow(/row limit/);
    await expect(readOvdbJsonRecordStream(streamed(['{"records":[],"columns":[],"complete":true}']), vi.fn(), undefined,
      { bytes: 20, rows: 1, recordBytes: 1024, footerBytes: 1024 })).rejects.toThrow(/byte limit/);
    await expect(readOvdbJsonRecordStream(streamed(['{"records":[],"columns":[],"complete":true}']), vi.fn(), undefined,
      { bytes: 1024, rows: 1, recordBytes: 1024, footerBytes: 8 })).rejects.toThrow(/metadata exceeds/);
    await expect(readOvdbJsonRecordStream(streamed(['{"records":[{"data":{"id":1}}],"columns":["id"],"execution":{},"complete":false,"complete":true}']),
      vi.fn())).rejects.toThrow(/Duplicate JSON field/);
  });

  it('cancels an open stream and never accepts later footer bytes', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
    const abort = new AbortController();
    const seen = vi.fn();
    const run = readOvdbJsonRecordStream(new Response(body, { headers: { 'Content-Type': 'application/json' } }), seen, abort.signal);
    source.enqueue(encoder.encode('{"records":[{"data":{"id":1}}'));
    await vi.waitFor(() => expect(seen).toHaveBeenCalledOnce());
    abort.abort(new Error('cancelled'));
    await expect(run).rejects.toThrow('cancelled');
  });
});
