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
 * error.
 */
export function selectTugqlBodyFile(
  stem: string,
  siblingFileNames: ReadonlySet<string>,
): IQueryBodyFile {
  const textName = `${stem}.tugql`;
  const yamlName = `${stem}.tugql.yaml`;
  const hasText = siblingFileNames.has(textName);
  const hasYaml = siblingFileNames.has(yamlName);
  if (hasText && hasYaml) {
    throw new Error(
      `A saved TugQL query has more than one body file (${textName}, ${yamlName}); keep exactly one.`,
    );
  }
  if (hasYaml) return { fileName: yamlName, representation: 'yaml' };
  // Neither exists: name the text form so the missing-file path reports it.
  return { fileName: textName, representation: 'text' };
}
