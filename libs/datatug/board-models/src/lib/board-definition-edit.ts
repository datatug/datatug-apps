import type { ChartWidgetDef } from './widget-chart';
import type { BoardParameterDef } from './widget-parameter';
import type { Board, BoardCard } from './board';
import type { BoardWidget } from './board-widget';
import { validateBoardPresentation } from './board-presentation';
import { validBoardParameterDefinitions } from './widget-parameter';
import { applyBoardAction } from './tutorial-board';
import type { ProjectCard } from './card';
import { BOARD_WIDGET_NAME_FIELDS, BOARD_WIDGET_NAME_TEXT, CARD_ID_PATTERN } from './card';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: object, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const literal = (value: unknown): boolean =>
  value == null ||
  ['string', 'boolean'].includes(typeof value) ||
  (typeof value === 'number' &&
    Number.isFinite(value) &&
    !Object.is(value, -0) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))) ||
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
const bindings = (value: unknown, message: string): void => {
  if (
    value != null &&
    (!Array.isArray(value) ||
      !value.every(
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
    throw new Error(message);
};
/** A dashboard cell's reference to a project card. */
export function validateCardRef(ref: unknown): void {
  if (
    !record(ref) ||
    !keys(ref, ['cardId', 'parameters']) ||
    typeof ref['cardId'] !== 'string' ||
    !CARD_ID_PATTERN.test(ref['cardId'])
  )
    throw new Error('Unsupported project card reference.');
  bindings(ref['parameters'], 'Unsupported project card parameter binding.');
}
/** Bounded structural admission of one widget graph (boards and project cards). */
export function validateHostedWidget(value: BoardWidget, depth: number): void {
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
    bindings(sql['parameters'], 'Unsupported saved-query parameter binding.');
  } else if (value.name === 'tabs') {
    if (
      !keys(value.data, ['title', 'parameters', 'tabs']) ||
      !Array.isArray(value.data['tabs'])
    )
      throw new Error('Unsupported tabs definition.');
    for (const tab of value.data['tabs']) {
      if (!record(tab) || !keys(tab, ['id', 'title', 'widget', 'widgets']))
        throw new Error('Unsupported tab definition.');
      if (tab['widget']) validateHostedWidget(tab['widget'] as BoardWidget, depth + 1);
      if (tab['widgets'] != null) {
        if (!Array.isArray(tab['widgets']))
          throw new Error('Unsupported tab definition.');
        for (const inner of tab['widgets'])
          validateHostedWidget(inner as BoardWidget, depth + 1);
      }
    }
  } else if (value.name === BOARD_WIDGET_NAME_TEXT) {
    if (
      !keys(value.data, ['title', 'parameters', 'markdown']) ||
      typeof value.data['markdown'] !== 'string'
    )
      throw new Error('Unsupported text widget.');
  } else if (value.name === BOARD_WIDGET_NAME_FIELDS) {
    const source = value.data['source'];
    const fields = value.data['fields'];
    if (
      !keys(value.data, ['title', 'parameters', 'source', 'fields']) ||
      !record(source) ||
      !(
        (keys(source, ['parameter']) &&
          typeof source['parameter'] === 'string' &&
          !!source['parameter']) ||
        (keys(source, ['queryId', 'parameters']) &&
          typeof source['queryId'] === 'string' &&
          !!source['queryId'])
      ) ||
      (fields != null &&
        (!Array.isArray(fields) ||
          !fields.every(
            (f) =>
              record(f) &&
              keys(f, ['column', 'label']) &&
              typeof f['column'] === 'string' &&
              !!f['column'] &&
              (f['label'] == null || typeof f['label'] === 'string'),
          )))
    )
      throw new Error('Unsupported fields widget.');
    if ('queryId' in source)
      bindings(source['parameters'], 'Unsupported saved-query parameter binding.');
  } else if (value.name === 'chart') {
    const chart = value.data as unknown as ChartWidgetDef;
    if (
      chart.sources.some((source) =>
        source.parameters?.some((binding) => !literal(binding.value)),
      )
    )
      throw new Error('Unsupported exact chart parameter literal.');
  } else throw new Error('Unsupported hosted board widget.');
}
const checkNumbers = (root: unknown): void => {
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
  numbers(root);
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
  checkNumbers(board);
  validateBoardPresentation(board);
  for (const row of board.rows ?? []) {
    if (!keys(row, ['minHeight', 'maxHeight', 'cards']))
      throw new Error('Unsupported board row.');
    for (const card of row.cards ?? []) {
      if (!record(card) || !keys(card, ['id', 'title', 'cols', 'widget', 'ref']))
        throw new Error('Unsupported board card.');
      // Exactly one of an inline widget or a project-card reference.
      if (!!card.widget === !!card.ref)
        throw new Error('A board card needs exactly one of widget or ref.');
      if (card.widget) validateHostedWidget(card.widget, 0);
      if (card.ref) validateCardRef(card.ref);
    }
  }
}

/**
 * Validates a `cards/<id>/card.json` value and returns it typed. Cards carry
 * parameters (with `match`), a default `display` and exactly one inline
 * widget; they never carry `ref`, `cols` or access fields.
 */
export function validateProjectCard(value: unknown): ProjectCard {
  if (
    !record(value) ||
    !keys(value, ['id', 'title', 'description', 'parameters', 'display', 'widget']) ||
    typeof value['id'] !== 'string' ||
    !CARD_ID_PATTERN.test(value['id']) ||
    typeof value['title'] !== 'string' ||
    (value['description'] != null && typeof value['description'] !== 'string') ||
    (value['display'] != null && !['panel', 'tooltip'].includes(String(value['display'])))
  )
    throw new Error('Unsupported or incomplete project card.');
  checkNumbers(value);
  const params = value['parameters'];
  if (
    !validBoardParameterDefinitions(params, { allowMatch: true }) ||
    params?.some(
      (item) =>
        item.lookup != null ||
        (['record', 'recordset'].includes(item.type)
          ? item.defaultValue != null
          : !literal(item.defaultValue)),
    )
  )
    throw new Error('Unsupported project card parameter definition.');
  if (new Set(params?.map((p) => p.id)).size !== (params?.length ?? 0))
    throw new Error('Project card parameter ids must be distinct.');
  if (!record(value['widget']))
    throw new Error('A project card needs exactly one widget.');
  validateBoardPresentation({
    rows: [{ cards: [{ widget: value['widget'] }] }],
  });
  validateHostedWidget(value['widget'] as unknown as BoardWidget, 0);
  return value as unknown as ProjectCard;
}
export type BoardDefinitionEdit =
  | { type: 'title'; title: string }
  | { type: 'set-chart'; cardId: string; definition: ChartWidgetDef }
  | { type: 'set-parameter'; parameter: BoardParameterDef }
  | {
      type: 'bind-board-parameter';
      cardId: string;
      parameterId: string;
      boardParameterId: string;
    }
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
  else if (edit.type === 'set-parameter') {
    parameters([edit.parameter]);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(edit.parameter.id))
      throw new Error('Enter a canonical parameter ID.');
    next.parameters = [
      ...(next.parameters ?? []).filter((p) => p.id !== edit.parameter.id),
      {
        ...next.parameters?.find((p) => p.id === edit.parameter.id),
        ...clone(edit.parameter),
      },
    ];
  } else if (edit.type === 'set-chart') {
    const card = next.rows
      ?.flatMap((row) => row.cards ?? [])
      .find((item) => item.id === edit.cardId);
    if (!card) throw new Error('Select a board card.');
    // Admit the raw proposed graph before JSON cloning can erase numeric forms.
    card.widget = { name: 'chart', data: edit.definition };
    validateHostedBoardDefinition(next);
    if (
      edit.definition.sources.some(
        (source) => !authorizedQueryIds.includes(source.queryId),
      )
    )
      throw new Error('Choose a currently available saved query.');
    card.widget = { name: 'chart', data: clone(edit.definition) };
  } else if (edit.type === 'bind-board-parameter') {
    const card = next.rows
      ?.flatMap((row) => row.cards ?? [])
      .find((item) => item.id === edit.cardId);
    if (!next.parameters?.some((p) => p.id === edit.boardParameterId))
      throw new Error('Choose a declared board parameter.');
    if (card?.widget?.name === 'SQL') {
      const data = card.widget.data as {
        sql: { queryId: string; parameters?: { id: string }[] };
      };
      card.widget.data = {
        ...data,
        sql: {
          ...data.sql,
          parameters: [
            ...(data.sql.parameters ?? []).filter(
              (p) => p.id !== edit.parameterId,
            ),
            { id: edit.parameterId, boardParameterId: edit.boardParameterId },
          ],
        },
      };
    } else if (card?.widget?.name === 'chart') {
      const data = card.widget.data as ChartWidgetDef;
      if (data.sources.length !== 1)
        throw new Error('Select a single-source chart.');
      data.sources[0].parameters = [
        ...(data.sources[0].parameters ?? []).filter(
          (p) => p.id !== edit.parameterId,
        ),
        { id: edit.parameterId, boardParameterId: edit.boardParameterId },
      ];
    } else throw new Error('Select a saved-query card.');
  } else if (edit.type === 'remove-card')
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
