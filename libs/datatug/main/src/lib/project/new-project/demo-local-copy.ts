export const demoCopySlug = (dataset: string): string => /^[a-z][a-z0-9-]{0,63}$/.test(dataset) ? `${dataset}-datatug` : 'my-datatug-project';
export const shellQuote = (value: string): string => "'" + value.replaceAll("'", "'\"'\"'") + "'";
export function localCopyCommands(dataset: string, file: string, folder: string, projectID: string): string | undefined {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(folder) || !/^[a-z][a-z0-9-]{0,79}$/.test(projectID) ||
    !file.startsWith('/') || file.length > 4096 || /[\r\n\0]/.test(file)) return undefined;
  const dbName = `${/^[a-z][a-z0-9-]{0,63}$/.test(dataset) ? dataset : 'demo'}-browser`;
  return [
    `git clone https://github.com/datatug/datatug-demo-project.git ${folder}`,
    `cd ${folder}/demo-project-1`,
    `datatug projects add --project ${projectID} --directory "$PWD"`,
    `datatug db add --project ${projectID} --db ${shellQuote(file)} --env local --name ${dbName}`,
    `datatug scan --project ${projectID} --env local --db ${dbName} --driver sqlite3 --path ${shellQuote(file)}`,
    'datatug serve --project "$PWD" --as local --role admin --allow-writes --open-browser',
  ].join('\n');
}
export function demoExportError(error: unknown): string {
  switch ((error as { code?: string } | undefined)?.code) {
    case 'sqlite_export_too_large': return 'This database exceeds the 256 MiB download limit. Keep using the database in this browser.';
    case 'sqlite_export_busy': return 'The database is busy. Finish the current edit or query, then try the download again.';
    case 'leader_changed': return 'The active database tab changed. Wait for it to reconnect, then retry the download.';
    case 'worker_unavailable': return 'The database worker is unavailable. Return to the demo and reopen your local copy explicitly before retrying.';
    default: return error instanceof Error ? error.message : 'The edited database could not be downloaded. Keep this page open and try again.';
  }
}
