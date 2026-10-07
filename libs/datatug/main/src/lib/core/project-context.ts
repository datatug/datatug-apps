export interface IProjectRef {
  readonly storeId: string;
  readonly projectId: string;
  /** Present only for Space-owned cloud projects; never inferred from ambient state. */
  readonly spaceID?: string;
  /** Explicit authenticated common-API transport; never a permission grant. */
  readonly projectApi?: 'cloud' | 'local';
  readonly branch?: string;
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
  a?.spaceID === b?.spaceID &&
  a?.projectApi === b?.projectApi &&
  a?.branch === b?.branch;

export function isValidProjectRef(v: IProjectRef): boolean {
  return (
    !!(v?.storeId && v?.projectId) &&
    (v.spaceID === undefined || isSharedProjectRef(v)) &&
    (v.projectApi === undefined || (v.spaceID === undefined && !!v.branch &&
      (v.projectApi === 'cloud' ? ['github.com', 'github'].includes(v.storeId) :
        v.projectApi === 'local' && !['github.com', 'github', 'firestore'].includes(v.storeId))))
  );
}

export function projectRefToString(v?: IProjectRef): string | undefined {
  return (
    v &&
    (v.projectApi !== undefined
      ? JSON.stringify(['common-project/1', v.projectApi, v.storeId, v.projectId, v.branch])
      : v.spaceID === undefined
        ? `${v.projectId}@${v.storeId}`
        : JSON.stringify([
            'space-project/1',
            v.storeId,
            v.spaceID,
            v.projectId,
          ]))
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
