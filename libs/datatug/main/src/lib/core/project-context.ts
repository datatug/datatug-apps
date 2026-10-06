export interface IProjectRef {
  readonly storeId: string;
  readonly projectId: string;
  /** Present only for Space-owned cloud projects; never inferred from ambient state. */
  readonly spaceID?: string;
}

export interface IProjectItemRef extends IProjectRef {
  readonly id: string;
}

export const equalProjectRef = (
  a: IProjectRef | undefined,
  b: IProjectRef | undefined,
) =>
  a?.projectId === b?.projectId &&
  a?.storeId === b?.storeId &&
  a?.spaceID === b?.spaceID;

export function isValidProjectRef(v: IProjectRef): boolean {
  return (
    !!(v?.storeId && v?.projectId) &&
    (v.spaceID === undefined || isSharedProjectRef(v))
  );
}

export function projectRefToString(v?: IProjectRef): string | undefined {
  return (
    v &&
    (v.spaceID === undefined
      ? `${v.projectId}@${v.storeId}`
      : JSON.stringify(['space-project/1', v.storeId, v.spaceID, v.projectId]))
  );
}

/** Matches the released backend ValidateSharedProjectIdentifier contract. */
export const isSharedProjectIdentifier = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);

export function isSharedProjectRef(v: IProjectRef): boolean {
  return (
    v?.storeId === 'firestore' &&
    isSharedProjectIdentifier(v.spaceID) &&
    isSharedProjectIdentifier(v.projectId)
  );
}
