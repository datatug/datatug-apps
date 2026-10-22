import type {
  BoardWidget,
  CardParameterDef,
  WidgetParameterBinding,
} from '@datatug/board-models';

/** Pure widget edits behind the card widget editor. All return new objects. */

export type EditableWidgetKind = 'text' | 'fields' | 'SQL' | 'chart';

export const WIDGET_KIND_LABELS: Record<EditableWidgetKind, string> = {
  text: 'Text',
  fields: 'Fields of one record',
  SQL: 'Grid of rows',
  chart: 'Chart',
};

export const isEditableKind = (name: string): name is EditableWidgetKind =>
  name === 'text' || name === 'fields' || name === 'SQL' || name === 'chart';

export type WidgetSource =
  | { kind: 'query'; queryId: string; parameters: WidgetParameterBinding[] }
  | { kind: 'parameter'; parameter: string };

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const dataOf = (widget: BoardWidget): Data =>
  (widget.data && typeof widget.data === 'object' ? widget.data : {}) as Data;

/** Where a `fields` or `SQL` (grid) widget takes its rows from. */
export function getSource(widget: BoardWidget): WidgetSource | undefined {
  const data = dataOf(widget);
  if (widget.name === 'SQL') {
    if (typeof data['source']?.parameter === 'string')
      return { kind: 'parameter', parameter: data['source'].parameter };
    return {
      kind: 'query',
      queryId: data['sql']?.queryId ?? '',
      parameters: [...(data['sql']?.parameters ?? [])],
    };
  }
  if (widget.name === 'fields') {
    const source = data['source'];
    if (typeof source?.parameter === 'string')
      return { kind: 'parameter', parameter: source.parameter };
    return {
      kind: 'query',
      queryId: source?.queryId ?? '',
      parameters: [...(source?.parameters ?? [])],
    };
  }
  return undefined;
}

/** The widget with its row source replaced; other data (title, fields) is kept. */
export function setSource(widget: BoardWidget, source: WidgetSource): BoardWidget {
  const data = { ...dataOf(widget) };
  if (widget.name === 'SQL') {
    delete data['sql'];
    delete data['source'];
    if (source.kind === 'parameter') data['source'] = { parameter: source.parameter };
    else
      data['sql'] = {
        queryId: source.queryId,
        ...(source.parameters.length ? { parameters: source.parameters } : {}),
      };
  } else {
    delete data['source'];
    data['source'] =
      source.kind === 'parameter'
        ? { parameter: source.parameter }
        : {
            queryId: source.queryId,
            ...(source.parameters.length ? { parameters: source.parameters } : {}),
          };
  }
  return { ...widget, data };
}

/** A fresh widget of a kind, wired to the first suitable card input when there is one. */
export function newWidget(
  kind: EditableWidgetKind,
  parameters: readonly CardParameterDef[],
  firstQueryId = '',
): BoardWidget {
  const record = parameters.find((p) => p.type === 'record');
  const recordset = parameters.find((p) => p.type === 'recordset');
  switch (kind) {
    case 'text':
      return { name: 'text', data: { markdown: '' } };
    case 'fields':
      return {
        name: 'fields',
        data: {
          source: record
            ? { parameter: record.id }
            : { queryId: firstQueryId },
        },
      };
    case 'SQL':
      return {
        name: 'SQL',
        data: recordset
          ? { source: { parameter: recordset.id } }
          : { sql: { queryId: firstQueryId } },
      };
    default:
      return { name: 'SQL', data: { sql: { queryId: firstQueryId } } };
  }
}

/** The select value of a query-parameter binding: '' (default), `p:<card input>` or `v` (fixed value). */
export function bindingChoice(
  parameters: readonly WidgetParameterBinding[],
  id: string,
): string {
  const b = parameters.find((x) => x.id === id);
  if (!b) return '';
  if (b.boardParameterId !== undefined) return `p:${b.boardParameterId}`;
  return 'value' in b ? 'v' : '';
}

export function bindingValue(
  parameters: readonly WidgetParameterBinding[],
  id: string,
): string {
  const v = parameters.find((x) => x.id === id)?.value;
  return v == null ? '' : String(v);
}

/** The bindings with query parameter `id` set to a choice from {@link bindingChoice}. */
export function withBinding(
  parameters: readonly WidgetParameterBinding[],
  id: string,
  choice: string,
  value = '',
  type = 'string',
): WidgetParameterBinding[] {
  const others = parameters.filter((x) => x.id !== id);
  if (choice === '') return others;
  if (choice.startsWith('p:'))
    return [...others, { id, boardParameterId: choice.slice(2) }];
  const typed =
    ['integer', 'number', 'float', 'money'].includes(type) &&
    value.trim() !== '' &&
    !isNaN(Number(value))
      ? Number(value)
      : type === 'boolean' || type === 'bit'
        ? value.toLowerCase() === 'true'
        : value;
  return [...others, { id, value: typed }];
}

/** `Column` or `Column = Label` lines <-> the `fields` widget's column list. */
export function fieldsToText(
  fields: readonly { column: string; label?: string }[] | undefined,
): string {
  return (fields ?? [])
    .map((f) => (f.label ? `${f.column} = ${f.label}` : f.column))
    .join('\n');
}

export function textToFields(
  text: string,
): { column: string; label?: string }[] | undefined {
  const fields = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [column, ...rest] = line.split('=');
      const label = rest.join('=').trim();
      return label
        ? { column: column.trim(), label }
        : { column: column.trim() };
    })
    .filter((f) => f.column);
  return fields.length ? fields : undefined;
}
