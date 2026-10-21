import type { Board, BoardCard } from './board';
import type { BoardWidget } from './board-widget';
import { validateBoardPresentation } from './board-presentation';
import { validBoardParameterDefinitions } from './widget-parameter';
import { applyBoardAction } from './tutorial-board';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: object, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const literal = (value: unknown): boolean =>
  value == null ||
  ['string', 'boolean'].includes(typeof value) ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (Array.isArray(value) &&
    value.length <= 1000 &&
    value.every((item) => !Array.isArray(item) && literal(item)));
const parameters = (value: unknown): void => {
  if (
    !validBoardParameterDefinitions(value) ||
    value?.some((item) => item.lookup != null || !literal(item.defaultValue))
  )
    throw new Error(
      'Unsupported hosted parameter definition; inline lookups are unavailable.',
    );
};
/** Admit raw numeric lexemes before JSON.parse can silently round a persisted definition. */
export function parseHostedBoardDefinition(raw: string): Board {
  if (new TextEncoder().encode(raw).length > 256 * 1024)
    throw new Error('Board definition exceeds the read limit.');
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"') {
      for (i++; i < raw.length; i++) {
        if (raw[i] === '\\') i++;
        else if (raw[i] === '"') break;
      }
    } else if (raw[i] === '-' || /[0-9]/.test(raw[i])) {
      const token =
        /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
          raw.slice(i),
        )?.[0];
      if (!token) continue; // JSON.parse below owns malformed JSON syntax.
      const value = Number(token);
      if (
        !Number.isFinite(value) ||
        (Number.isInteger(value) && !Number.isSafeInteger(value)) ||
        JSON.stringify(value) !== token
      )
        throw new Error(
          'This board contains unsupported numeric precision or number form. Use a compatible editor.',
        );
      i += token.length - 1;
    }
  }
  const board = JSON.parse(raw) as Board;
  validateHostedBoardDefinition(board);
  return board;
}
/** Hosted definitions are the canonical Go board wire; never strip unsupported data. */
export function validateHostedBoardDefinition(board: Board): void {
  if (
    !record(board) ||
    !keys(board, [
      'id',
      'title',
      'folder',
      'tags',
      'userIds',
      'access',
      'parameters',
      'requiredParams',
      'rows',
    ]) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(board.id) ||
    typeof board.title !== 'string'
  )
    throw new Error('Unsupported or incomplete board definition.');
  parameters(board.parameters);
  let remaining = 131072;
  const numbers = (value: unknown, depth = 0): void => {
    if (--remaining < 0 || depth > 64)
      throw new Error('Board definition exceeds validation limits.');
    if (
      typeof value === 'number' &&
      (!Number.isFinite(value) ||
        (Number.isInteger(value) && !Number.isSafeInteger(value)) ||
        Object.is(value, -0))
    )
      throw new Error('Unsupported numeric precision in board definition.');
    if (Array.isArray(value)) value.forEach((item) => numbers(item, depth + 1));
    else if (record(value))
      Object.values(value).forEach((item) => numbers(item, depth + 1));
  };
  numbers(board);
  validateBoardPresentation(board);
  const widget = (value: BoardWidget, depth: number): void => {
    if (
      depth > 8 ||
      !record(value) ||
      !keys(value, ['name', 'data']) ||
      !record(value.data)
    )
      throw new Error('Unsupported board widget.');
    parameters(value.data['parameters']);
    if (value.name === 'SQL') {
      const sql = value.data['sql'];
      if (
        !keys(value.data, ['title', 'parameters', 'sql']) ||
        !record(sql) ||
        !keys(sql, ['queryId', 'parameters', 'presentationFilter']) ||
        typeof sql['queryId'] !== 'string' ||
        !sql['queryId']
      )
        throw new Error(
          'Choose a saved query; inline SQL is unavailable for hosted boards.',
        );
      const bindings = sql['parameters'];
      if (
        bindings != null &&
        (!Array.isArray(bindings) ||
          !bindings.every(
            (binding) =>
              record(binding) &&
              keys(binding, ['id', 'value', 'boardParameterId']) &&
              typeof binding['id'] === 'string' &&
              !!binding['id'] &&
              literal(binding['value']) &&
              (binding['boardParameterId'] == null ||
                (typeof binding['boardParameterId'] === 'string' &&
                  !!binding['boardParameterId'] &&
                  binding['value'] == null)),
          ))
      )
        throw new Error('Unsupported saved-query parameter binding.');
    } else if (value.name === 'tabs') {
      if (
        !keys(value.data, ['title', 'parameters', 'tabs']) ||
        !Array.isArray(value.data['tabs'])
      )
        throw new Error('Unsupported tabs definition.');
      for (const tab of value.data['tabs']) {
        if (!record(tab) || !keys(tab, ['id', 'title', 'widget']))
          throw new Error('Unsupported tab definition.');
        if (tab['widget']) widget(tab['widget'] as BoardWidget, depth + 1);
      }
    } else if (value.name !== 'chart')
      throw new Error('Unsupported hosted board widget.');
  };
  for (const row of board.rows ?? []) {
    if (!keys(row, ['minHeight', 'maxHeight', 'cards']))
      throw new Error('Unsupported board row.');
    for (const card of row.cards ?? []) {
      if (!keys(card, ['id', 'title', 'cols', 'widget']))
        throw new Error('Unsupported board card.');
      if (card.widget) widget(card.widget, 0);
    }
  }
}
export type BoardDefinitionEdit =
  | { type: 'title'; title: string }
  | { type: 'add-query'; cardId: string; queryId: string; title: string }
  | { type: 'set-query'; cardId: string; queryId: string }
  | { type: 'bind-query'; cardId: string; parameterId: string; value?: unknown }
  | { type: 'remove-card'; cardId: string };
/** Structured definition edits reuse canonical board validation and card actions. */
export function editBoardDefinition(
  board: Board,
  edit: BoardDefinitionEdit,
  authorizedQueryIds: readonly string[],
): Board {
  validateHostedBoardDefinition(board);
  let next = clone(board);
  if (edit.type === 'title') next.title = edit.title;
  else if (edit.type === 'remove-card')
    next = applyBoardAction(board, board, edit);
  else if (edit.type === 'bind-query') {
    const card = next.rows
      ?.flatMap((row) => row.cards ?? [])
      .find((item) => item.id === edit.cardId);
    if (!card || card.widget?.name !== 'SQL')
      throw new Error('Select a saved-query card.');
    const data = card.widget.data as {
      sql: { queryId: string; parameters?: { id: string; value?: unknown }[] };
    };
    const parameters = (data.sql.parameters ?? []).filter(
      (item) => item.id !== edit.parameterId,
    );
    if (edit.value !== undefined)
      parameters.push({ id: edit.parameterId, value: edit.value });
    card.widget = {
      ...card.widget,
      data: { ...data, sql: { ...data.sql, parameters } },
    };
  } else {
    if (!authorizedQueryIds.includes(edit.queryId))
      throw new Error('Choose a currently available saved query.');
    if (edit.type === 'add-query') {
      if (
        (next.rows ?? []).some((row) =>
          row.cards?.some((card) => card.id === edit.cardId),
        )
      )
        throw new Error('Duplicate board card.');
      const card: BoardCard = {
        id: edit.cardId,
        title: edit.title,
        widget: { name: 'SQL', data: { sql: { queryId: edit.queryId } } },
      };
      next.rows = [...(next.rows ?? []), { cards: [card] }];
    } else {
      const card = next.rows
        ?.flatMap((row) => row.cards ?? [])
        .find((item) => item.id === edit.cardId);
      if (!card || card.widget?.name !== 'SQL')
        throw new Error('Select a saved-query card.');
      card.widget = {
        ...card.widget,
        data: {
          ...(card.widget.data as object),
          sql: {
            ...(card.widget.data as { sql: object }).sql,
            queryId: edit.queryId,
            ...((card.widget.data as { sql: { queryId: string } }).sql
              .queryId !== edit.queryId
              ? { parameters: [] }
              : {}),
          },
        },
      };
    }
  }
  validateHostedBoardDefinition(next);
  return next;
}
