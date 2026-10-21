import {
  IParameterDef,
  IParameterValueWithoutID,
} from '../../models/definition/parameter';

/** Shared manual board-input parsing; runtime values never change the stored definition. */
export function parseBoardParameterValue(
  def: IParameterDef,
  raw: unknown,
): IParameterValueWithoutID | undefined {
  const invalid = (message: string): never => {
    throw new Error(message);
  };
  if (raw == null || raw === '') {
    if (def.isRequired !== false)
      return invalid(`Enter a value for ${def.title || def.id}.`);
    return undefined;
  }
  if (def.isMultiValue || !['string', 'number', 'boolean'].includes(typeof raw))
    return invalid('Enter a single parameter value.');
  const text = String(raw);
  switch (def.type) {
    case 'integer': {
      const number = Number(text);
      if (!/^-?(0|[1-9][0-9]*)$/.test(text) || !Number.isSafeInteger(number))
        return invalid(
          'Enter a whole number within the supported integer range.',
        );
      return { type: def.type, value: number };
    }
    case 'number':
    case 'float':
    case 'money': {
      const number = Number(text);
      if (
        !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?$/i.test(
          text,
        ) ||
        !Number.isFinite(number)
      )
        return invalid('Enter a finite number.');
      return { type: def.type, value: number };
    }
    case 'boolean':
    case 'bit':
      if (raw === true || text === 'true' || text === '1')
        return { type: def.type, value: true };
      if (raw === false || text === 'false' || text === '0')
        return { type: def.type, value: false };
      return invalid('Enter true or false.');
    case 'date':
    case 'datetime': {
      const date = text.slice(0, 10);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
        new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date ||
        (def.type === 'date'
          ? text !== date
          : !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
              text,
            ) || !Number.isFinite(Date.parse(text)))
      )
        return invalid(
          def.type === 'date'
            ? 'Enter an ISO date (YYYY-MM-DD).'
            : 'Enter an ISO date and time including its timezone.',
        );
      return { type: def.type, value: text };
    }
    case 'string':
    case 'text':
    case 'UUID':
    case 'GUID':
      if (
        (def.minLength !== undefined && text.length < def.minLength) ||
        (def.maxLength !== undefined && text.length > def.maxLength)
      )
        return invalid('The parameter text is outside its allowed length.');
      return { type: def.type, value: text };
    default:
      return invalid(
        `Manual entry is unavailable for parameter type ${def.type}.`,
      );
  }
}
