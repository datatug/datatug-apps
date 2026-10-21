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
        retryUnauthorizedOnce: true,
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
