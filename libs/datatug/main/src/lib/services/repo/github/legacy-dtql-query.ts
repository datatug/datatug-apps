// Removed in TugQL cutover step 9.
//
// Until the public demo project (`datatug/datatug-demo-project`) is migrated,
// the live demo reads the pre-rename forms of a saved TugQL query:
//   - `"type": "DTQL"` in `<id>.query.json`, and
//   - the body file `<id>.query.dtql`, which holds the structured TugQL YAML.
// Every reader that touches a query goes through this module, so deleting it
// (and its call sites) is the whole of step 9. Writers never produce these forms.

/** The query `type` value that predates TugQL. */
export const LEGACY_DTQL_QUERY_TYPE = 'DTQL';

/** The body file extension that predates `.tugql.yaml`; its content is TugQL YAML. */
export const LEGACY_DTQL_BODY_EXTENSION = 'dtql';
