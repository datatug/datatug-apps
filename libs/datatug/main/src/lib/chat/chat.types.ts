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
  readonly dtql?: string;
  readonly rows?: readonly Record<string, unknown>[];
  readonly error?: string;
  readonly metrics?: ChatMetrics;
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
      name: 'Customer',
      fields: ['CustomerId', 'FirstName', 'LastName', 'City', 'Country', 'Email'],
    },
    {
      schema: 'main',
      name: 'Invoice',
      fields: ['InvoiceId', 'CustomerId', 'InvoiceDate', 'BillingCity', 'BillingCountry', 'Total'],
    },
    {
      schema: 'main',
      name: 'Track',
      fields: ['TrackId', 'Name', 'AlbumId', 'GenreId', 'Milliseconds', 'UnitPrice', 'ArtistName'],
    },
  ],
} as const;

export const CHINOOK_SCHEMA_PROMPT = `Chinook schema (use DTQL only):
main.Invoice(InvoiceId, CustomerId, InvoiceDate, BillingCity, BillingCountry, Total) — orders means invoices.
main.Customer(CustomerId, FirstName, LastName, City, Country, Email).
main.Track(TrackId, Name, AlbumId, GenreId, Milliseconds, UnitPrice, ArtistName) — ArtistName is derived from Album/Artist.
Return one bounded single-source DTQL query.`;
