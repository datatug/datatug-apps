import { HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, map } from 'rxjs';
import { IProjectRef } from '../core/project-context';
import { DatatugApiService } from '../services/base/datatug-api.service';
import { SHIPPING_SOURCE, shippingScope } from './shipping-api.service';

export const SHIPPING_COMPONENT = 'shipping-investigation';
export const SHIPPING_COMPONENT_COMMIT =
  'cb841345e88d01229857b2bdb51cc07f4ef4bec7';
export const SHIPPING_COMPONENT_QUERIES = [
  'shipping/assignment-outcome',
  'shipping/current-route',
  'shipping/events',
  'shipping/historical-route',
  'shipping/partner-enabled',
  'shipping/readiness',
  'shipping/request-receipt',
  'shipping/timings',
] as const;
export interface ShippingComponentVersion {
  componentId: typeof SHIPPING_COMPONENT;
  version: 1;
  digest: string;
  sourceCommit: typeof SHIPPING_COMPONENT_COMMIT;
}
export interface ShippingComponentInstallation extends ShippingComponentVersion {
  actorId: string;
  operationId: string;
  installedAt: string;
  queryIds: string[];
  checkIds: string[];
  entityIds: string[];
  boardIds: string[];
}
export interface ShippingComponentState {
  available: ShippingComponentVersion;
  exists: boolean;
  installation?: ShippingComponentInstallation;
}
export interface ShippingComponentIntent {
  spaceID: string;
  projectId: string;
  sourceId: typeof SHIPPING_SOURCE;
  environment: 'demo';
  operationId: string;
  componentId: typeof SHIPPING_COMPONENT;
  version: 1;
  componentDigest: string;
}
const invalid = () =>
  new Error(
    'Shipping component metadata could not be verified. Refresh before installing.',
  );
export function componentVersion(
  value: ShippingComponentVersion,
): ShippingComponentVersion {
  if (
    !value ||
    value.componentId !== SHIPPING_COMPONENT ||
    value.version !== 1 ||
    value.sourceCommit !== SHIPPING_COMPONENT_COMMIT ||
    typeof value.digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.digest)
  )
    throw invalid();
  return {
    componentId: value.componentId,
    version: value.version,
    digest: value.digest,
    sourceCommit: value.sourceCommit,
  };
}
export function componentInstallation(
  value: ShippingComponentInstallation,
): ShippingComponentInstallation {
  const version = componentVersion(value);
  const matches = (actual: string[], expected: readonly string[]) =>
    Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((id, index) => id === [...expected].sort()[index]);
  if (
    typeof value.actorId !== 'string' ||
    !value.actorId ||
    value.actorId.length > 128 ||
    typeof value.operationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.operationId) ||
    typeof value.installedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(
      value.installedAt,
    ) ||
    !Number.isFinite(Date.parse(value.installedAt)) ||
    !matches(value.queryIds, SHIPPING_COMPONENT_QUERIES) ||
    !matches(value.checkIds, ['shipping-request-received']) ||
    !matches(value.entityIds, ['Order', 'ShippingRequest']) ||
    !matches(value.boardIds, ['shipping'])
  )
    throw invalid();
  return {
    ...version,
    actorId: value.actorId,
    operationId: value.operationId,
    installedAt: value.installedAt,
    queryIds: [...value.queryIds],
    checkIds: [...value.checkIds],
    entityIds: [...value.entityIds],
    boardIds: [...value.boardIds],
  };
}
export function componentIntent(
  ref: IProjectRef,
  value: ShippingComponentIntent,
): ShippingComponentIntent {
  const scope = shippingScope(ref);
  if (
    !value ||
    Object.keys(value).sort().join(',') !==
      'componentDigest,componentId,environment,operationId,projectId,sourceId,spaceID,version' ||
    value.spaceID !== scope.spaceID ||
    value.projectId !== scope.project ||
    value.sourceId !== SHIPPING_SOURCE ||
    value.environment !== 'demo' ||
    value.componentId !== SHIPPING_COMPONENT ||
    value.version !== 1 ||
    typeof value.componentDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.componentDigest) ||
    typeof value.operationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.operationId)
  )
    throw invalid();
  return Object.freeze({ ...value });
}
@Injectable({ providedIn: 'root' })
export class ShippingComponentApiService {
  private readonly api = inject(DatatugApiService);
  current(ref: IProjectRef) {
    return defer(() =>
      this.api.get<ShippingComponentState>(
        'datatug/shipping/component',
        new HttpParams({
          fromObject: { ...shippingScope(ref), environment: 'demo' },
        }),
      ),
    ).pipe(
      map((value) => {
        const available = componentVersion(value?.available);
        if (
          typeof value.exists !== 'boolean' ||
          (value.exists
            ? !value.installation
            : value.installation !== undefined)
        )
          throw invalid();
        const installation = value.installation
          ? componentInstallation(value.installation)
          : undefined;
        if (installation && installation.digest !== available.digest)
          throw invalid();
        return {
          available,
          exists: value.exists,
          ...(installation ? { installation } : {}),
        };
      }),
    );
  }
  install(ref: IProjectRef, intent: ShippingComponentIntent, actor: string) {
    return defer(() => {
      const frozen = componentIntent(ref, intent);
      if (!actor) throw invalid();
      return this.api.post<ShippingComponentInstallation>(
        'datatug/shipping/component',
        frozen,
        { retryUnauthorizedOnce: false },
      );
    }).pipe(
      map((value) => {
        const result = componentInstallation(value);
        if (
          result.actorId !== actor ||
          result.operationId !== intent.operationId ||
          result.digest !== intent.componentDigest
        )
          throw new Error(
            'Installation receipt could not be verified. Keep the original operation for review.',
          );
        return result;
      }),
    );
  }
}
