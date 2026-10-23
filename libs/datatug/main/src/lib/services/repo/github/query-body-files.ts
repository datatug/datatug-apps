import {
  LEGACY_DTQL_BODY_EXTENSION,
  LEGACY_DTQL_QUERY_TYPE,
} from './legacy-dtql-query';

/** How a saved TugQL query body is written, decided by which body file exists. */
export type TugqlBodyRepresentation = 'text' | 'yaml';

export interface IQueryBodyFile {
  /** Path of the body file relative to the folder that holds the definition. */
  readonly fileName: string;
  /** Absent for non-TugQL (SQL/HTTP) bodies. */
  readonly representation?: TugqlBodyRepresentation;
}

/**
 * Picks the body file of a TugQL query from the sibling file names.
 *
 * `<id>.query.tugql` is the TugQL text form and `<id>.query.tugql.yaml` the
 * structured YAML form; the file name alone decides, and having both is an
 * error. A definition of the legacy `DTQL` type reads `<id>.query.dtql` as
 * TugQL YAML (see ./legacy-dtql-query.ts).
 */
export function selectTugqlBodyFile(
  stem: string,
  type: string,
  siblingFileNames: ReadonlySet<string>,
): IQueryBodyFile {
  const textName = `${stem}.tugql`;
  const yamlName = `${stem}.tugql.yaml`;
  const legacyName = `${stem}.${LEGACY_DTQL_BODY_EXTENSION}`;
  const present = [
    siblingFileNames.has(textName) && textName,
    siblingFileNames.has(yamlName) && yamlName,
    type === LEGACY_DTQL_QUERY_TYPE &&
      siblingFileNames.has(legacyName) &&
      legacyName,
  ].filter((name): name is string => !!name);
  if (present.length > 1) {
    throw new Error(
      `A saved TugQL query has more than one body file (${present.join(', ')}); keep exactly one.`,
    );
  }
  if (present[0] === yamlName || present[0] === legacyName) {
    return { fileName: present[0], representation: 'yaml' };
  }
  // Neither exists: name the text form so the missing-file path reports it.
  return {
    fileName: textName,
    representation: type === LEGACY_DTQL_QUERY_TYPE ? 'yaml' : 'text',
  };
}
