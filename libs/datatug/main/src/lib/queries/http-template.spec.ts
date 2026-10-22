import vectors from './http-template-vectors.json';
import {
  HttpTemplateError,
  formatHttpNumber,
  goPathEscape,
  goQueryEscape,
  httpTemplateHasPlaceholders,
  httpTemplatePlaceholders,
  placeholderNames,
  renderHttpParameterValue,
  substituteHttpTemplate,
  validateHttpTemplate,
  type HttpParameterDecl,
  type HttpRequestTemplate,
} from './http-template';

interface VectorCase {
  name: string;
  mode: 'save' | 'run' | 'server';
  template: HttpRequestTemplate;
  parameters?: HttpParameterDecl[];
  runParameters?: { id: string; type: string; value: unknown }[];
  values?: Record<string, unknown>;
  expect?: Partial<HttpRequestTemplate>;
  error?: { code: string; parameter?: string; position?: string; header?: string };
}

/** Server template mode, as Core SubstituteHTTPRunParameters derives it. */
function serverSubstitute(c: VectorCase): HttpRequestTemplate {
  const credential = new Set(
    httpTemplatePlaceholders(c.template)
      .filter((p) => p.credential)
      .map((p) => p.name),
  );
  const run = c.runParameters ?? [];
  return substituteHttpTemplate(
    c.template,
    run.map((p) => ({
      id: p.id,
      type: p.type,
      isRequired: true,
      isCredential: credential.has(p.id),
    })),
    Object.fromEntries(run.map((p) => [p.id, p.value])),
  );
}

describe('HTTP template shared vectors (datatug-core testdata)', () => {
  for (const c of vectors.cases as unknown as VectorCase[]) {
    it(c.name, () => {
      let got: HttpRequestTemplate | undefined;
      let error: unknown;
      try {
        if (c.mode === 'save') validateHttpTemplate(c.template, c.parameters ?? []);
        else if (c.mode === 'run')
          got = substituteHttpTemplate(c.template, c.parameters ?? [], c.values ?? {});
        else got = serverSubstitute(c);
      } catch (e) {
        error = e;
      }
      if (c.error) {
        expect(error).toBeInstanceOf(HttpTemplateError);
        const te = error as HttpTemplateError;
        expect(te.code).toBe(c.error.code);
        if (c.error.parameter) expect(te.parameter).toBe(c.error.parameter);
        if (c.error.position) expect(te.position).toBe(c.error.position);
        if (c.error.header) expect(te.header).toBe(c.error.header);
        expect(te.message).not.toBe('');
        return;
      }
      expect(error).toBeUndefined();
      for (const key of ['url', 'method', 'body', 'headers'] as const)
        if (c.expect && key in c.expect) expect(got?.[key]).toEqual(c.expect[key]);
    });
  }

  it('renders values like Core RenderHTTPParameterValue', () => {
    for (const r of vectors.render as { type: string; value: unknown; expect: string | null }[])
      expect([r.type, r.value, renderHttpParameterValue(r.type, r.value) ?? null]).toEqual([
        r.type,
        r.value,
        r.expect,
      ]);
  });
});

describe('HTTP template helpers', () => {
  it('lists placeholder names skipping {{literal}}', () => {
    expect(placeholderNames('a {x} {{y}} {z}')).toEqual(['x', 'z']);
    expect(httpTemplateHasPlaceholders({ url: 'https://x.test/{{a}}' })).toBe(false);
    expect(httpTemplateHasPlaceholders({ url: 'https://x.test/', headers: [{ name: 'X', value: '{a}' }] })).toBe(true);
  });

  it('escapes like Go', () => {
    expect(goPathEscape('a b/😀')).toBe('a%20b%2F%F0%9F%98%80');
    expect(goQueryEscape('a b+😀')).toBe('a+b%2B%F0%9F%98%80');
    expect(goQueryEscape('\ud800')).toBe('%EF%BF%BD');
  });

  it('formats numbers without an exponent', () => {
    expect(formatHttpNumber(1e21)).toBe('1000000000000000000000');
    expect(formatHttpNumber(-1.5e-7)).toBe('-0.00000015');
    expect(formatHttpNumber(1.25e22)).toBe('12500000000000000000000');
    expect(formatHttpNumber(-0)).toBe('0');
  });
});
