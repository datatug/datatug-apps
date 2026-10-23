import { formatTugQL, parseTugQL } from '@dalgo/core';
import {
  acceptCompletion,
  autocompletion,
  CompletionContext,
  completionStatus,
  type CompletionResult,
  type CompletionSource,
  currentCompletions,
  startCompletion,
} from '@codemirror/autocomplete';
import { history, redo, undo } from '@codemirror/commands';
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  createRawSourceExtensions,
  getRawSource,
} from './author-code-editor.component';
import {
  createTugqlCompletionExtension,
  declaredParameters,
  inferKeywordCase,
  TUGQL_COMPLETION_KEYWORDS,
} from './tugql-completion';

describe('TugQL explicit completion', () => {
  const completion = (
    source: string,
    requestedPos?: number,
    explicit = true,
    options: { readonly enabled?: boolean; readonly readOnly?: boolean } = {},
  ): { readonly state: EditorState; readonly result: CompletionResult | null } => {
    const normalized = source.replace(/\r\n|\r/gu, '\n');
    const pos = requestedPos ?? normalized.length;
    const state = EditorState.create({
      doc: source,
      selection: { anchor: pos },
      extensions: [
        ...(options.readOnly ? [EditorState.readOnly.of(true)] : []),
        createTugqlCompletionExtension(() => options.enabled ?? true),
      ],
    });
    const sourceForState = state.languageDataAt<CompletionSource>('autocomplete', pos)[0];
    const result =
      (sourceForState?.(new CompletionContext(state, pos, explicit)) as
        | CompletionResult
        | null
        | undefined) ?? null;
    return {
      state,
      result,
    };
  };

  const labels = (result: CompletionResult | null): string[] =>
    result?.options.map((option) => option.label) ?? [];

  it('suggests only grammar-backed keywords and exact parameter type words', () => {
    const validExamples: Record<string, string> = {
      from: 'from Invoice',
      join: 'from Invoice\njoin Customer\n  on Invoice.CustomerId = Customer.CustomerId',
      left: 'from Invoice\nleft join Customer\n  on Invoice.CustomerId = Customer.CustomerId',
      on: 'from Invoice\njoin Customer\n  on Invoice.CustomerId = Customer.CustomerId',
      where: 'from Invoice\nwhere InvoiceId = 1',
      group: 'from Invoice\ngroup by InvoiceId',
      by: 'from Invoice\ngroup by InvoiceId',
      having: 'from Invoice\ngroup by InvoiceId\nhaving InvoiceId > 1',
      order: 'from Invoice\norder by InvoiceId',
      limit: 'from Invoice\nlimit 10',
      offset: 'from Invoice\nlimit 10\noffset 1',
      select: 'from Invoice\nselect InvoiceId',
      as: 'from Invoice\nselect InvoiceId as Id',
      and: 'from Invoice\nwhere InvoiceId = 1 and CustomerId = 2',
      or: 'from Invoice\nwhere InvoiceId = 1 or CustomerId = 2',
      not: 'from Invoice\nwhere InvoiceId is not null',
      is: 'from Invoice\nwhere InvoiceId is null',
      null: 'from Invoice\nwhere InvoiceId is null',
      asc: 'from Invoice\norder by InvoiceId asc',
      desc: 'from Invoice\norder by InvoiceId desc',
      true: 'from Invoice\nwhere InvoiceId = true',
      false: 'from Invoice\nwhere InvoiceId = false',
      with: 'with Sample as (\n  from Invoice\n)\nfrom Sample',
      parameters: 'parameters (\n  @Code integer required\n)\nfrom Invoice',
      required: 'parameters (\n  @Code integer required\n)\nfrom Invoice',
      default: "parameters (\n  @Code integer default 1\n)\nfrom Invoice",
      using: 'with Sample from "query.tugql"\n  using (\n    @Code = 1\n  )\nfrom Sample',
      integer: 'parameters (\n  @Code integer required\n)\nfrom Invoice',
      decimal: 'parameters (\n  @Code decimal default 1.2\n)\nfrom Invoice',
      string: "parameters (\n  @Code string default 'x'\n)\nfrom Invoice",
      boolean: 'parameters (\n  @Code boolean default true\n)\nfrom Invoice',
      date: "parameters (\n  @Code date default '2026-01-01'\n)\nfrom Invoice",
      datetime: "parameters (\n  @Code datetime default '2026-01-01T00:00:00Z'\n)\nfrom Invoice",
      timestamp: "parameters (\n  @Code timestamp default '2026-01-01T00:00:00Z'\n)\nfrom Invoice",
    };

    expect(Object.keys(validExamples).sort()).toEqual(
      [...TUGQL_COMPLETION_KEYWORDS].sort(),
    );
    for (const [keyword, source] of Object.entries(validExamples)) {
      expect(parseTugQL(source).diagnostics, keyword).toEqual([]);
    }
    for (const unsupported of [
      'inner', 'outer', 'cross', 'distinct', 'exists', 'union',
      'int', 'numeric', 'float', 'bool', 'time', 'json', 'uuid',
    ]) {
      expect(TUGQL_COMPLETION_KEYWORDS).not.toContain(unsupported);
    }
  });

  it('matches formatter keyword case without treating strings or identifiers as case evidence', () => {
    expect(inferKeywordCase("select 'FROM' as Label -- WHERE\nfrom Invoice")).toBe('lowercase');
    expect(inferKeywordCase('FROM Invoice\nWHERE InvoiceId = 1')).toBe('uppercase');
    expect(inferKeywordCase('from Customer as c\nselect c.from')).toBe('lowercase');
    expect(inferKeywordCase('select fromMixed')).toBe('lowercase');
    const mixed = 'Parameters (\n  @from INTEGER REQUIRED\n)\nFROM Dummy';
    expect(inferKeywordCase(mixed)).toBe('uppercase');
    const formatted = formatTugQL(mixed, {
      keywordCase: 'preserve-existing',
      defaultKeywordCase: 'lowercase',
    }).source;
    expect(formatted).toMatch(/^PARAMETERS\s*\(/u);
    expect(formatted).toContain('@from INTEGER REQUIRED');
    expect(formatted).toMatch(/\nFROM Dummy/u);
    expect(inferKeywordCase(formatted)).toBe('uppercase');

    expect(labels(completion('FROM Invoice\nSEL').result)).toContain('SELECT');
    expect(labels(completion('from Invoice\nsel').result)).toContain('select');
  });

  it('offers parser-proven parameters from a valid document or a closed leading block while the body is incomplete', () => {
    const source = [
      '-- saved declaration',
      '',
      'parameters ( -- declarations remain parser-owned',
      '  @CustomerId integer required',
      '  @Café string default \'x\'',
      ')',
      'from Invoice',
      'where InvoiceId = @Cust',
    ].join('\r\n');
    expect(declaredParameters(source)).toEqual(['CustomerId', 'Café']);
    const result = completion(source).result;
    const normalizedLength = source.replace(/\r\n|\r/gu, '\n').length;
    expect(result?.from).toBe(normalizedLength - 'Cust'.length);
    expect(labels(result)).toEqual(['CustomerId', 'Café']);

    const headerComment = 'parameters ( -- declaration block\n  @CustomerId integer required\n)\nfrom Invoice\nwhere InvoiceId = @C and';
    expect(declaredParameters(headerComment)).toEqual(['CustomerId']);
    expect(
      labels(completion(headerComment, headerComment.lastIndexOf('@C') + 2).result),
    ).toEqual(['CustomerId']);

    const valid = 'parameters (\n  @CustomerId integer required\n)\nfrom Invoice\nwhere InvoiceId = @C';
    expect(declaredParameters(valid)).toEqual(['CustomerId']);
  });

  it('fails closed for malformed, unclosed, duplicate, nested, or conflicting parameter blocks', () => {
    const cases = [
      'parameters (\n  @CustomerId int required\n)\nfrom Invoice\nwhere InvoiceId = @C',
      'parameters (\n  @CustomerId integer required\nfrom Invoice\nwhere InvoiceId = @C',
      'parameters (\n  @CustomerId integer required\n  @CustomerId integer required\n)\nfrom Invoice\nwhere InvoiceId = @C',
      'parameters (\n  @CustomerId integer required\n)\nfrom Invoice\nparameters (\n  @Other integer required\n)\nwhere InvoiceId = @C',
      'parameters (\n  @CustomerId integer required\n)\nfrom Invoice\nPARAMETERS\nwhere InvoiceId = @C',
      'parameters (\n  @CustomerId integer required\n  parameters (\n)\nfrom Invoice\nwhere InvoiceId = @C',
    ];
    for (const source of cases) {
      expect(declaredParameters(source)).toEqual([]);
      expect(completion(source).result).toBeNull();
    }
  });

  it('requires an explicit request and suppresses unsafe lexical and editor states', () => {
    const source = 'from Invoice\nwhere InvoiceId = @CustomerId';
    expect(completion(source, source.length, false).result).toBeNull();
    expect(completion('-- @CustomerId').result).toBeNull();
    const quoted = "from Invoice\nwhere Name = '@CustomerId'";
    expect(completion(quoted, quoted.indexOf('@CustomerId')).result).toBeNull();
    expect(completion('from Invoice\nselect Invoice.Id').result).toBeNull();
    const midToken = 'from Invoice\nwhere InvoiceId = @CustomerIdNext';
    expect(completion(midToken, midToken.indexOf('Next')).result).toBeNull();
    expect(completion(source, source.length, true, { enabled: false }).result).toBeNull();
    expect(completion(source, source.length, true, { readOnly: true }).result).toBeNull();

    const multiState = EditorState.create({
      doc: source,
      selection: EditorSelection.cursor(source.length),
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        createTugqlCompletionExtension(() => true),
      ],
    }).update({
      selection: EditorSelection.create([
        EditorSelection.cursor(source.length),
        EditorSelection.cursor(1),
      ]),
    }).state;
    const multiSource = multiState.languageDataAt<CompletionSource>('autocomplete', source.length)[0];
    expect(multiSource?.(new CompletionContext(multiState, source.length, true))).toBeNull();

    const composing = EditorState.create({
      doc: source,
      selection: { anchor: source.length },
      extensions: [createTugqlCompletionExtension(() => true)],
    });
    const sourceDuringComposition = composing.languageDataAt<CompletionSource>('autocomplete', composing.doc.length)[0];
    expect(
      sourceDuringComposition?.(
        new CompletionContext(composing, composing.doc.length, true, { composing: true } as EditorView),
      ),
    ).toBeNull();

    const selected = EditorState.create({
      doc: source,
      selection: { anchor: source.length - 3, head: source.length },
      extensions: [createTugqlCompletionExtension(() => true)],
    });
    const sourceWithSelection = selected.languageDataAt<CompletionSource>('autocomplete', selected.selection.main.head)[0];
    expect(sourceWithSelection?.(new CompletionContext(selected, selected.selection.main.head, true))).toBeNull();
  });

  it('keeps the registered CodeMirror completion source identity stable', () => {
    const source = 'from Invoice\nwhere InvoiceId = @C';
    const state = EditorState.create({
      doc: source,
      selection: { anchor: source.length },
      extensions: [createTugqlCompletionExtension(() => true)],
    });
    const first = state.languageDataAt<CompletionSource>(
      'autocomplete',
      source.length,
    )[0];
    const second = state.languageDataAt<CompletionSource>(
      'autocomplete',
      source.length,
    )[0];
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it('does not apply a stale popup option after the editor becomes read-only or non-editable', async () => {
    const source = 'from Invoice\nwhere InvoiceId = 1';
    const readonly = new Compartment();
    const editable = new Compartment();
    const state = EditorState.create({
      doc: source,
      selection: { anchor: source.length },
      extensions: [
        readonly.of(EditorState.readOnly.of(false)),
        editable.of(EditorView.editable.of(true)),
        autocompletion({ interactionDelay: 0 }),
        createTugqlCompletionExtension(() => true),
      ],
    });
    const host = document.createElement('div');
    document.body.append(host);
    const view = new EditorView({ state, parent: host });
    try {
      view.focus();
      expect(startCompletion(view)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const option = currentCompletions(view.state).find(
        (completionOption) => completionOption.label === 'from',
      );
      expect(option).toBeDefined();

      view.dispatch({
        effects: [
          readonly.reconfigure(EditorState.readOnly.of(true)),
          editable.reconfigure(EditorView.editable.of(false)),
        ],
      });
      expect(typeof option?.apply).toBe('function');
      if (typeof option?.apply === 'function' && option) {
        option.apply(view, option, source.length, source.length);
      }
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it('accepts a single prefix replacement and preserves mixed raw line endings through undo and redo', async () => {
    const source = 'parameters (\r\n  @CustomerId integer required\r\n)\r\nfrom Invoice\r\nwhere InvoiceId = @Cust\nlimit 3\r';
    const normalized = source.replace(/\r\n|\r/gu, '\n');
    const cursor = normalized.indexOf('\nlimit 3');
    const state = EditorState.create({
      doc: source,
      selection: { anchor: cursor },
      extensions: [
        history(),
        createRawSourceExtensions(source),
        autocompletion({ interactionDelay: 0 }),
        createTugqlCompletionExtension(() => true),
      ],
    });
    const host = document.createElement('div');
    document.body.append(host);
    const view = new EditorView({ state, parent: host });
    try {
      view.focus();
      const sourceForView = view.state.languageDataAt<CompletionSource>('autocomplete', cursor)[0];
      expect(
        (sourceForView?.(
          new CompletionContext(view.state, cursor, true, view),
        ) as CompletionResult | null)?.options.map((option) => option.label),
      ).toEqual(['CustomerId']);
      expect(startCompletion(view)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(completionStatus(view.state)).toBe('active');
      expect(currentCompletions(view.state).map((option) => option.label)).toEqual(['CustomerId']);
      expect(acceptCompletion(view)).toBe(true);
      const completedSource = 'parameters (\r\n  @CustomerId integer required\r\n)\r\nfrom Invoice\r\nwhere InvoiceId = @CustomerId\nlimit 3\r';
      expect(getRawSource(view.state)).toBe(completedSource);

      expect(undo(view)).toBe(true);
      expect(getRawSource(view.state)).toBe(source);
      expect(redo(view)).toBe(true);
      expect(getRawSource(view.state)).toBe(completedSource);
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
