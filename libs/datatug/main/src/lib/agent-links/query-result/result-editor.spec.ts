import { describe, expect, it } from 'vitest';
import { QueryType } from '../../models/definition/query-def';
import { decodeStoredResult } from './query-result';
import { resultEditorPlan } from './result-editor';
import {
  DTQL_TEXT,
  PROMPT_TEXT,
  ROW_MARKER,
  editorReadyResult,
  invoiceCustomerResult,
} from './query-result.spec-helper';

const plan = (response: Record<string, unknown>) =>
  resultEditorPlan(decodeStoredResult(response), 'draft-1');

describe('decodeStoredResult: the editor-ready members', () => {
  it('reads query.text, language, dbRef and params, and the prompt with its truncation', () => {
    const r = decodeStoredResult(
      editorReadyResult({ prompt: { text: PROMPT_TEXT, truncated: true } }),
    );
    expect(r.editor.text).toBe(DTQL_TEXT);
    expect(r.editor.language).toBe('dtql');
    expect(r.editor.dbRef).toBe('datatug://demo/chinook?env=local');
    expect(r.editor.params.map((p) => p.name)).toEqual([
      'CustomerId',
      'Countries',
    ]);
    expect(r.prompt).toEqual({ text: PROMPT_TEXT, truncated: true });
  });
  it('reads them from meta when the answer has no top-level query or prompt', () => {
    const full = editorReadyResult();
    const answer = { meta: full['meta'], recordset: full['recordset'] };
    const r = decodeStoredResult(answer);
    expect(r.editor.text).toBe(DTQL_TEXT);
    expect(r.prompt?.text).toBe(PROMPT_TEXT);
  });
  it('takes an older result as having none of them', () => {
    const r = decodeStoredResult(invoiceCustomerResult());
    expect(r.editor).toEqual({ params: [] });
    expect(r.prompt).toBeUndefined();
  });
  it('drops a malformed language and nameless params', () => {
    const r = decodeStoredResult(
      editorReadyResult({
        query: { language: 'cobol', params: [{ value: 1 }, { name: '' }, 5] },
      }),
    );
    expect(r.editor.language).toBeUndefined();
    expect(r.editor.params).toEqual([]);
  });
  it('reads unavailable.editor', () => {
    const r = decodeStoredResult(
      editorReadyResult({ unavailable: { editor: 'too-large' } }),
    );
    expect(r.meta.unavailable.editor).toBe('too-large');
  });
});

describe('resultEditorPlan', () => {
  it('fills a new draft from an ad-hoc DTQL result, with its database, environment and parameters', () => {
    const p = plan(editorReadyResult());
    expect(p.mode).toBe('draft');
    expect(p.definition).toMatchObject({
      id: 'draft-1',
      request: { queryType: QueryType.DTQL, text: DTQL_TEXT },
    });
    expect(p.ids).toEqual({ project: 'demo', env: 'local', source: 'chinook' });
    expect(p.definition?.parameters).toEqual([
      { id: 'CustomerId', type: 'integer' },
      { id: 'Countries', type: 'string', isMultiValue: true },
    ]);
    // a scalar is bound, a list is named but not bound
    expect(p.parameters.map((x) => [x.id, x.value?.value])).toEqual([
      ['CustomerId', '2'],
      ['Countries', undefined],
    ]);
    expect(p.notice).toBeUndefined();
  });
  it('fills a SQL draft', () => {
    const p = plan(
      editorReadyResult({
        query: { language: 'sql', text: 'select 1', params: [] },
      }),
    );
    expect(p.definition?.request).toEqual({
      queryType: QueryType.SQL,
      text: 'select 1',
    });
    expect(p.definition?.parameters).toBeUndefined();
  });
  it('shows the saved rows as a snapshot recorded when the result was saved, without running anything', () => {
    const p = plan(editorReadyResult());
    expect(p.displayed.provenance).toEqual({
      source: 'chinook',
      mode: 'snapshot',
      observedAt: '2026-10-16T08:00:00Z',
    });
    expect(p.displayed.recordset.rows).toHaveLength(2);
    expect(p.displayed.recordset.rows[0][2]).toEqual({
      type: 'string',
      value: ROW_MARKER,
    });
    expect(p.displayed.truncated).toBe(false);
    expect(p.rowsKept).toBe(2);
    expect(p.hasMore).toBe(true);
    expect(p.savedAt).toBe('2026-10-16T08:00:00Z');
  });
  it('opens a saved query by its id and environment', () => {
    const p = plan(
      editorReadyResult({
        query: {
          kind: 'saved',
          savedQueryId: 'folder/top-customers',
          language: 'sql',
          text: 'select 1',
        },
      }),
    );
    expect(p.mode).toBe('saved');
    expect(p.savedQueryId).toBe('folder/top-customers');
    expect(p.definition).toBeUndefined();
    expect(p.ids?.env).toBe('local');
  });
  it.each([
    [
      'an older result with no editor members',
      invoiceCustomerResult(),
      /older DataTug/,
    ],
    [
      'text dropped for size',
      editorReadyResult({
        query: { text: undefined, params: undefined },
        unavailable: { editor: 'too-large' },
      }),
      /too large/,
    ],
    [
      'a saved HTTP query',
      editorReadyResult({
        query: {
          kind: 'saved',
          savedQueryId: '',
          language: 'http',
          text: undefined,
        },
      }),
      /HTTP query/,
    ],
    [
      'a result with a language but no text',
      editorReadyResult({ query: { text: undefined } }),
      /not kept/,
    ],
  ])(
    'leaves the editor empty with a named message for %s, and still shows the rows',
    (_name, response, notice) => {
      const p = plan(response);
      expect(p.mode).toBe('rows-only');
      expect(p.notice).toMatch(notice);
      expect(p.definition).toBeUndefined();
      expect(p.displayed.recordset.rows).toHaveLength(2);
      expect(p.summary[0]).toMatch(/^Kind: /);
    },
  );
  it('summarises the saved query read-only: kind, saved query, database, parameter names, rows', () => {
    const p = plan(
      editorReadyResult({
        query: {
          kind: 'saved',
          savedQueryId: 'q1',
          language: 'http',
          text: undefined,
        },
      }),
    );
    expect(p.summary).toEqual([
      'Kind: saved',
      'Saved query: q1',
      'Database: chinook in environment local',
      'Parameters: CustomerId, Countries',
      'Rows: 2 saved, more rows exist',
    ]);
    const bare = plan(
      invoiceCustomerResult({
        db: { ref: null, project: null, env: null, source: null },
      }),
    );
    expect(bare.summary).toContain(
      'Database: not a source of a DataTug project',
    );
    expect(bare.ids).toBeUndefined();
    expect(bare.displayed.provenance.source).toBe('saved result');
  });
  it('takes a parameter it cannot read as absent', () => {
    const p = plan(
      editorReadyResult({
        query: {
          params: [
            { name: 'x', value: 'plain' },
            { name: 'y', value: null },
          ],
        },
      }),
    );
    expect(p.parameters).toEqual([]);
  });
});
