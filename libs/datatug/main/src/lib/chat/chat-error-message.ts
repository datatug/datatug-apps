/** What a failed chat turn shows: a plain-language line, and the engine's own text on demand. */
export interface ChatErrorView {
  readonly summary: string;
  /** Technical text for an expandable "details" area; absent when the summary already says everything. */
  readonly detail?: string;
}

/** The DTQL engine reports `<code> at <path>: <reason>`, for example `join_aggregate at orderBy[0]: ...`. */
const engineError = /^([a-z]+(?:_[a-z]+)+) at \S+: /;
const longMessage = 240;

const engineSummaries: Readonly<Record<string, string>> = {
  join_aggregate: 'That question needs totals or counts, but the columns it asks for cannot be grouped that way. ' +
    'Try asking again with the grouping spelled out, for example "total sales per country".',
  join_field: 'That question refers to a column that is not available in this data. Try rephrasing it with the columns shown in the schema.',
  join_scope: 'That question refers to a table or column that is not available at that point. Try rephrasing it with the tables shown in the schema.',
};
const genericEngineSummary = 'That question could not be turned into a query DataTug can run. Try rephrasing it, or ask for something simpler.';

export function chatErrorView(raw: string | undefined): ChatErrorView {
  const message = raw?.trim();
  if (!message) return { summary: 'Unable to answer that question.' };
  const code = engineError.exec(message)?.[1];
  if (code) return { summary: engineSummaries[code] ?? genericEngineSummary, detail: message };
  if (message.length > longMessage || message.includes('\n')) {
    return { summary: 'Something went wrong while answering that question.', detail: message };
  }
  return { summary: message };
}
