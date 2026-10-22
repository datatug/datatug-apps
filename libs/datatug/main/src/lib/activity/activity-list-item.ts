/** Presentation data only; identifiers are opaque to the list, never authority. */
export interface ActivityListItem {
  /** Unique within this list. The owner resolves this ID in its current scope. */
  readonly id: string;
  readonly title: string;
  readonly outcome: string;
  readonly acceptedAt: string;
  readonly metadata?: string;
  readonly detail?: { readonly label: string; readonly text: string };
  readonly openLabel: string;
}
