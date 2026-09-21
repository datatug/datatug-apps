export type ChatProtocol = 'openai-chat' | 'anthropic-messages';

export interface ChatProvider {
  readonly id: string;
  readonly name: string;
  readonly protocol: ChatProtocol;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

export interface ChatTurn {
  readonly id: string;
  readonly question: string;
  readonly state: 'loading' | 'result' | 'empty' | 'error';
  readonly queryId?: string;
  readonly recordSetId?: string;
  readonly dtql?: string;
  readonly generatedDtql?: string;
  readonly dtqlYaml?: string;
  readonly sql?: string;
  readonly rows?: readonly Record<string, unknown>[];
  readonly columns?: readonly string[];
  readonly error?: string;
  readonly metrics?: ChatMetrics;
  readonly actionSummary?: string;
  readonly join?: ChatJoinLineage;
  readonly joinChoices?: readonly ChatJoinChoice[];
}

export interface ChatJoinChoice {
  readonly recordSetId: string;
  readonly candidateId: string;
  readonly label: string;
}

/** Immutable FK evidence captured when a joined result is created. */
export interface ChatJoinLineage {
  readonly candidateId: string;
  readonly manifestVersion: string;
  readonly foreignKeyId: string;
  readonly direction: 'forward' | 'reverse';
  readonly sourcePath: readonly number[];
  readonly sourceAlias: string;
  readonly targetAlias: string;
  readonly sourceTable: string;
  readonly targetTable: string;
  readonly sourceFields: readonly string[];
  readonly targetFields: readonly string[];
}

export interface ChatMetrics {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly interpretMs: number;
  readonly queryMs: number;
}

export const CHINOOK_SCHEMA = {
  tables: [
    {
      schema: 'main',
      name: 'Artist',
      fields: ['ArtistId', 'Name'],
    },
    {
      schema: 'main',
      name: 'Album',
      fields: ['AlbumId', 'Title', 'ArtistId'],
    },
    {
      schema: 'main',
      name: 'Track',
      fields: ['TrackId', 'Name', 'AlbumId', 'MediaTypeId', 'GenreId', 'Composer', 'Milliseconds', 'Bytes', 'UnitPrice', 'ArtistName'],
    },
    {
      schema: 'main',
      name: 'Genre',
      fields: ['GenreId', 'Name'],
    },
    {
      schema: 'main',
      name: 'MediaType',
      fields: ['MediaTypeId', 'Name'],
    },
    {
      schema: 'main',
      name: 'Playlist',
      fields: ['PlaylistId', 'Name'],
    },
    {
      schema: 'main',
      name: 'PlaylistTrack',
      fields: ['PlaylistId', 'TrackId'],
    },
    {
      schema: 'main',
      name: 'Customer',
      fields: ['CustomerId', 'FirstName', 'LastName', 'Company', 'Address', 'City', 'State', 'Country', 'PostalCode', 'Phone', 'Fax', 'Email', 'SupportRepId'],
    },
    {
      schema: 'main',
      name: 'Employee',
      fields: ['EmployeeId', 'LastName', 'FirstName', 'Title', 'ReportsTo', 'BirthDate', 'HireDate', 'Address', 'City', 'State', 'Country', 'PostalCode', 'Phone', 'Fax', 'Email'],
    },
    {
      schema: 'main',
      name: 'Invoice',
      fields: ['InvoiceId', 'CustomerId', 'InvoiceDate', 'BillingAddress', 'BillingCity', 'BillingState', 'BillingCountry', 'BillingPostalCode', 'Total'],
    },
    {
      schema: 'main',
      name: 'InvoiceLine',
      fields: ['InvoiceLineId', 'InvoiceId', 'TrackId', 'UnitPrice', 'Quantity'],
    },
  ],
} as const;

export const CHINOOK_SCHEMA_PROMPT = `Chinook schema (use DTQL only):
${CHINOOK_SCHEMA.tables.map(({ name, fields }) => `main.${name}(${fields.join(', ')})`).join('\n')}
Orders means invoices. Track.ArtistName is derived from Album and Artist.
Return one bounded single-source DTQL query, or use a supplied FK candidate ID for a JOIN request. Do not generate JOIN clauses or aggregation.`;
