// The Firestore *client* SDK cannot enumerate a document's subcollections
// (that introspection is Admin-SDK-only, by design — see the comment in
// `space-explorer.service.ts`). So the raw-data tree browser cannot show a
// truly complete "here are all the child collections" list; instead it
// offers these well-known collection-name shortcuts as a starting point,
// alongside a free-text field for any other collection name.
//
// Sourced from the `/spaces/{spaceID}/ext/{module}/{collection}/{itemID}`
// convention documented in
// `backstage/spec/research/core-modules-interface.md`.

/** Suggested next segment when standing on the `spaces/{spaceId}` document. */
export const KNOWN_SPACE_DOC_COLLECTIONS: readonly string[] = ['ext'];

/** Suggested module doc ids when standing on the `.../ext` collection. */
export const KNOWN_EXT_MODULES: readonly string[] = [
  'contactus',
  'listus',
  'calendarius',
  'assetus',
  'eventius',
  'invitus',
  'linkage',
];

/** Suggested collection names when standing on a `.../ext/{module}` doc. */
export const KNOWN_MODULE_COLLECTIONS: readonly string[] = [
  'contacts',
  'lists',
  'events',
  'assets',
  'invites',
  'items',
];
