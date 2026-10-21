import { HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, map } from 'rxjs';
import { IProjectRef, isSharedProjectRef } from '../core/project-context';
import { DatatugApiService } from '../services/base/datatug-api.service';

export const SHIPPING_SOURCE = 'shipping-working-copy';
export interface ShippingPointer {
  generation: string;
  revision: number;
  sha256: string;
}
export interface ShippingRevision extends ShippingPointer {
  fixtureCommit: string;
  fixtureSHA256: string;
  schemaSHA256: string;
  configuration: number;
  businessClock: string;
  bytes: number;
  artifacts: { id: string; sha256: string; bytes: number }[];
  actorId: string;
  acceptedAt: string;
}
export type ShippingAction = 'initialize' | 'correct' | 'replay' | 'reset';
export interface ShippingIntent {
  spaceID: string;
  projectId: string;
  sourceId: typeof SHIPPING_SOURCE;
  operationId: string;
  action: ShippingAction;
  expected?: ShippingPointer;
  orderId?: 11045 | 11062;
}
export interface ShippingAck {
  receipt: {
    operationId: string;
    actorId: string;
    action: ShippingAction;
    outcome: string;
    revision: ShippingRevision;
    acceptedAt: string;
    requestSHA256: string;
  };
  current: ShippingPointer;
}
export type ShippingPublicationState =
  | { exists: false }
  | { exists: true; publication: { revision: number; enabled: boolean } };
export interface ShippingPublicationIntent {
  spaceID: string;
  projectId: string;
  sourceId: typeof SHIPPING_SOURCE;
  environment: string;
  operationId: string;
  expectedRevision: number;
  enabled: boolean;
}
export function publicationEnvironment(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new Error('Choose an admitted environment.');
  return value;
}
export function validatePublicationIntent(
  ref: IProjectRef,
  value: ShippingPublicationIntent,
): void {
  const scope = shippingScope(ref);
  if (
    !value ||
    Object.keys(value).some(
      (key) =>
        ![
          'spaceID',
          'projectId',
          'sourceId',
          'environment',
          'operationId',
          'expectedRevision',
          'enabled',
        ].includes(key),
    ) ||
    value.spaceID !== scope.spaceID ||
    value.projectId !== scope.project ||
    value.sourceId !== SHIPPING_SOURCE ||
    typeof value.operationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.operationId) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0 ||
    value.expectedRevision >= 32 ||
    typeof value.enabled !== 'boolean'
  )
    throw new Error('Invalid query-access operation.');
  publicationEnvironment(value.environment);
}
export function shippingScope(ref: IProjectRef) {
  if (
    !isSharedProjectRef(ref) ||
    ref.branch !== undefined ||
    ref.projectApi !== undefined
  )
    throw new Error('Choose a native hosted project with a Space.');
  return {
    storage: 'firestore',
    spaceID: ref.spaceID,
    project: ref.projectId,
    sourceId: SHIPPING_SOURCE,
  };
}
export function shippingPointer(value: ShippingPointer): ShippingPointer {
  if (
    !value ||
    typeof value.generation !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.generation) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  )
    throw new Error(
      'Shipping revision is unavailable. Reload before making a change.',
    );
  return {
    generation: value.generation,
    revision: value.revision,
    sha256: value.sha256,
  };
}
export function validateShippingIntent(
  ref: IProjectRef,
  intent: ShippingIntent,
  actor: string,
): void {
  if (
    !intent ||
    typeof intent !== 'object' ||
    Object.keys(intent).some(
      (key) =>
        ![
          'spaceID',
          'projectId',
          'sourceId',
          'operationId',
          'action',
          'expected',
          'orderId',
        ].includes(key),
    )
  )
    throw new Error('Invalid shipping operation.');
  const scope = shippingScope(ref);
  if (
    !actor ||
    intent.spaceID !== scope.spaceID ||
    intent.projectId !== scope.project ||
    intent.sourceId !== SHIPPING_SOURCE ||
    typeof intent.operationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(intent.operationId) ||
    !['initialize', 'correct', 'replay', 'reset'].includes(intent.action) ||
    (intent.action === 'initialize' ? !!intent.expected : !intent.expected) ||
    (intent.action === 'replay'
      ? ![11045, 11062].includes(intent.orderId ?? 0)
      : intent.orderId !== undefined)
  )
    throw new Error('Invalid shipping operation.');
  if (intent.expected) shippingPointer(intent.expected);
}
@Injectable({ providedIn: 'root' })
export class ShippingApiService {
  private readonly api = inject(DatatugApiService);
  publication(ref: IProjectRef, environment: string) {
    return defer(() =>
      this.api.get<ShippingPublicationState>(
        'datatug/shipping/publication',
        new HttpParams({
          fromObject: {
            ...shippingScope(ref),
            environment: publicationEnvironment(environment),
          },
        }),
      ),
    ).pipe(
      map((value) => {
        if (
          !value ||
          typeof value.exists !== 'boolean' ||
          Object.keys(value).some(
            (key) => !['exists', 'publication'].includes(key),
          ) ||
          (!value.exists && 'publication' in value) ||
          (value.exists &&
            (!value.publication ||
              Object.keys(value.publication).some(
                (key) => !['revision', 'enabled'].includes(key),
              ) ||
              !Number.isSafeInteger(value.publication.revision) ||
              value.publication.revision < 1 ||
              value.publication.revision > 32 ||
              typeof value.publication.enabled !== 'boolean'))
        )
          throw new Error('Current query access could not be verified.');
        return value;
      }),
    );
  }
  publish(ref: IProjectRef, intent: ShippingPublicationIntent, actor: string) {
    return defer(() => {
      validatePublicationIntent(ref, intent);
      if (!actor) throw new Error('Sign in to change query access.');
      return this.api.post<{
        environment: string;
        revision: number;
        enabled: boolean;
        actorId: string;
      }>('datatug/shipping/publication', intent, {
        retryUnauthorizedOnce: false,
      });
    }).pipe(
      map((value) => {
        if (
          !value ||
          value.environment !== intent.environment ||
          value.enabled !== intent.enabled ||
          value.actorId !== actor ||
          value.revision !== intent.expectedRevision + 1
        )
          throw new Error(
            'Query-access acknowledgement is uncertain. Retry the original operation.',
          );
        return value;
      }),
    );
  }
  revision(ref: IProjectRef) {
    return defer(() =>
      this.api.get<ShippingRevision>(
        'datatug/shipping/revision',
        new HttpParams({ fromObject: shippingScope(ref) }),
      ),
    ).pipe(
      map((value) => {
        shippingPointer(value);
        if (
          ![17, 18].includes(value.configuration) ||
          !Array.isArray(value.artifacts) ||
          value.artifacts.some(
            (a) =>
              !a ||
              typeof a.id !== 'string' ||
              !/^[a-f0-9]{64}$/.test(a.sha256),
          )
        )
          throw new Error('Shipping metadata is unavailable.');
        return value;
      }),
    );
  }
  action(ref: IProjectRef, intent: ShippingIntent, actor: string) {
    return defer(() => {
      validateShippingIntent(ref, intent, actor);
      return this.api.post<ShippingAck>('datatug/shipping/action', intent, {
        retryUnauthorizedOnce: false,
      });
    }).pipe(
      map((value) => {
        if (
          value?.receipt?.operationId !== intent.operationId ||
          value.receipt.actorId !== actor ||
          value.receipt.action !== intent.action ||
          !['applied', 'already-applied'].includes(value.receipt.outcome)
        )
          throw new Error(
            'Receipt could not be verified. Retry the original operation.',
          );
        shippingPointer(value.current);
        shippingPointer(value.receipt.revision);
        return value;
      }),
    );
  }
}
