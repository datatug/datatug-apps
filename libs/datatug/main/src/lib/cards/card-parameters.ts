import type {
  BoardCardRef,
  CardParameterDef,
  ProjectCard,
} from '@datatug/board-models';
import type { IBoardContext } from '../models/definition/board/board';
import type {
  IParameterValueWithoutID,
  ParameterValueType,
} from '../models/definition/parameter';

/** True when a supplied parameter value counts as "not filled in". */
export const isBlankValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '');

/**
 * The values a dashboard cell's `ref` gives a card's parameters: a binding
 * takes a board parameter's current value or a constant; an unbound
 * parameter falls back to its own default.
 */
export function refParameterValues(
  card: Pick<ProjectCard, 'parameters'>,
  ref: Pick<BoardCardRef, 'parameters'>,
  board: IBoardContext | undefined,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const p of card.parameters ?? []) {
    const binding = ref.parameters?.find((b) => b.id === p.id);
    let value: unknown;
    if (binding?.boardParameterId !== undefined)
      value = board?.parameters?.[binding.boardParameterId]?.value;
    else if (binding && 'value' in binding) value = binding.value;
    else value = p.defaultValue;
    if (value !== undefined) values[p.id] = value;
  }
  return values;
}

/** Card parameter values as the board context the shared widgets read. */
export function cardBoardContext(
  base: IBoardContext | undefined,
  card: Pick<ProjectCard, 'parameters'>,
  values: Readonly<Record<string, unknown>>,
): IBoardContext {
  const parameters: Record<string, IParameterValueWithoutID> = {};
  for (const p of card.parameters ?? []) {
    const value = values[p.id] ?? p.defaultValue;
    if (value === undefined) continue;
    parameters[p.id] = {
      type: p.type as ParameterValueType,
      value: value as never,
    };
  }
  return { ...base, mode: 'view', parameters };
}

/** Required card parameters that still have no value. */
export function missingRequired(
  card: Pick<ProjectCard, 'parameters'>,
  values: Readonly<Record<string, unknown>>,
): CardParameterDef[] {
  return (card.parameters ?? []).filter(
    (p) =>
      p.isRequired === true && isBlankValue(values[p.id] ?? p.defaultValue),
  );
}
