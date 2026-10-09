export interface BusinessCheckoutSpaceBrief {
  readonly title?: string;
  readonly type?: string;
  readonly roles?: readonly string[];
}

export interface BusinessCheckoutSpace {
  readonly id: string;
  readonly title: string;
  readonly type: string;
}

const nonOrdinarySpaceTypes = new Set([
  'personal',
  'private',
  'system',
  'spot',
  'unknown',
]);

/**
 * Show only Spaces the signed-in user can administer. This read model does not
 * carry Space active status; the checkout service remains authoritative for
 * current status, membership and registered extension Space types.
 */
export function manageableBusinessSpaces(
  spaces: Readonly<Record<string, BusinessCheckoutSpaceBrief>> | undefined,
): BusinessCheckoutSpace[] {
  return Object.entries(spaces ?? {})
    .filter(
      ([id, space]) =>
        /^[A-Za-z0-9_-]{1,128}$/.test(id) &&
        !!space.type &&
        !nonOrdinarySpaceTypes.has(space.type) &&
        (space.roles ?? []).some(
          (role) => role === 'owner' || role === 'admin',
        ),
    )
    .map(([id, space]) => ({
      id,
      title: space.title?.trim() || 'Untitled Space',
      type: space.type ?? '',
    }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
