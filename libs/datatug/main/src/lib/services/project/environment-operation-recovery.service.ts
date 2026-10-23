import { inject, Injectable, InjectionToken } from '@angular/core';
import { openDB } from 'idb';
import { IProjectRef } from '../../core/project-context';
import { EnvironmentState } from '../../models/definition/environment-state';
import { EnvironmentWrite } from '../../models/definition/environment-receipt';

export interface PendingEnvironmentOperation {
  readonly version: 1;
  readonly actor: string;
  readonly project: IProjectRef;
  readonly before: EnvironmentState;
  readonly request: EnvironmentWrite;
  readonly attempts: number;
  readonly definitiveRejection?: boolean;
}
export interface EnvironmentRecoveryStore {
  read(key: string): Promise<PendingEnvironmentOperation | undefined>;
  reserve(key: string, operation: PendingEnvironmentOperation): Promise<void>;
  attempt(
    key: string,
    operationId: string,
  ): Promise<PendingEnvironmentOperation>;
  remove(
    key: string,
    operationId: string,
    rejectedAttempt?: number,
  ): Promise<void>;
}
function recoveryTargetKey(key: string): string {
  const tuple = JSON.parse(key) as unknown[];
  return JSON.stringify(['environment-pending-target/1', ...tuple.slice(2)]);
}
export const ENVIRONMENT_RECOVERY_STORE =
  new InjectionToken<EnvironmentRecoveryStore>(
    'Environment operation recovery',
    {
      providedIn: 'root',
      factory: () => {
        let opening: ReturnType<typeof openDB> | undefined;
        const database = () =>
          (opening ||= openDB('datatug-environment-operations', 1, {
            upgrade(db) {
              db.createObjectStore('pending');
            },
          }));
        return {
          read: async (key) => {
            const transaction = (await database()).transaction(
              'pending',
              'readonly',
            );
            const owner = await transaction.store.get(recoveryTargetKey(key));
            if (owner && owner !== key)
              throw new Error(
                'An operation for this target belongs to another actor or authority. Reconnect its original actor to recover it.',
              );
            return transaction.store.get(key);
          },
          reserve: async (key, value) => {
            const transaction = (await database()).transaction(
              'pending',
              'readwrite',
            );
            const owner = await transaction.store.get(recoveryTargetKey(key));
            if (owner && owner !== key) {
              transaction.abort();
              await transaction.done.catch(() => undefined);
              throw new Error(
                'An operation for this target is already awaiting its original actor.',
              );
            }
            const old: PendingEnvironmentOperation | undefined =
              await transaction.store.get(key);
            if (old && old.request.operationId !== value.request.operationId) {
              transaction.abort();
              await transaction.done.catch(() => undefined);
              throw new Error(
                'An environment operation is already awaiting confirmation.',
              );
            }
            if (old && old.attempts > value.attempts) {
              transaction.abort();
              await transaction.done.catch(() => undefined);
              throw new Error('Recovery operation changed in another tab.');
            }
            await transaction.store.put(key, recoveryTargetKey(key));
            await transaction.store.put(value, key);
            await transaction.done;
          },
          attempt: async (key, operationId) => {
            const transaction = (await database()).transaction(
              'pending',
              'readwrite',
            );
            const old: PendingEnvironmentOperation | undefined =
              await transaction.store.get(key);
            if (
              !old ||
              old.request.operationId !== operationId ||
              old.definitiveRejection
            ) {
              transaction.abort();
              await transaction.done.catch(() => undefined);
              throw new Error('Recovery operation changed.');
            }
            const current = { ...old, attempts: old.attempts + 1 };
            await transaction.store.put(current, key);
            await transaction.done;
            return current;
          },
          remove: async (key, operationId, rejectedAttempt) => {
            const transaction = (await database()).transaction(
              'pending',
              'readwrite',
            );
            const old: PendingEnvironmentOperation | undefined =
              await transaction.store.get(key);
            if (old?.request.operationId === operationId) {
              if (
                rejectedAttempt !== undefined &&
                (!old.definitiveRejection || old.attempts !== rejectedAttempt)
              ) {
                transaction.abort();
                await transaction.done.catch(() => undefined);
                throw new Error('Recovery changed in another tab.');
              }
              await transaction.store.delete(key);
              if ((await transaction.store.get(recoveryTargetKey(key))) === key)
                await transaction.store.delete(recoveryTargetKey(key));
            }
            await transaction.done;
          },
        };
      },
    },
  );
export function environmentRecoveryKey(
  actor: string,
  project: IProjectRef,
): string {
  return JSON.stringify([
    'environment-operation/1',
    actor,
    project.storeId,
    project.projectId,
    project.spaceID ?? null,
    project.projectApi ?? null,
    project.branch ?? null,
  ]);
}
@Injectable({ providedIn: 'root' })
export class EnvironmentOperationRecoveryService {
  private readonly store = inject(ENVIRONMENT_RECOVERY_STORE);
  private deadline<T>(operation: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Device recovery storage timed out.')),
        10000,
      );
      operation.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
  read(
    actor: string,
    project: IProjectRef,
  ): Promise<PendingEnvironmentOperation | undefined> {
    return this.deadline(
      this.store.read(environmentRecoveryKey(actor, project)),
    );
  }
  reserve(operation: PendingEnvironmentOperation): Promise<void> {
    const before = operation.before;
    operation = {
      ...operation,
      before: {
        contract: before.contract,
        scope: before.scope,
        scopeBinding: before.scopeBinding,
        environments: before.environments.map((environment) => ({
          id: environment.id,
          title: environment.title,
          ...(environment.access ? { access: environment.access } : {}),
          ...(environment.presentation
            ? {
                presentation: {
                  label: environment.presentation.label,
                  icon: environment.presentation.icon,
                  tone: environment.presentation.tone,
                },
              }
            : {}),
        })),
        savedOrder: before.savedOrder,
        order: before.order,
        needsRepair: before.needsRepair,
        revision: before.revision,
        capabilities: before.capabilities,
      },
    };
    return this.deadline(
      this.store.reserve(
        environmentRecoveryKey(operation.actor, operation.project),
        operation,
      ),
    );
  }
  attempt(
    operation: PendingEnvironmentOperation,
  ): Promise<PendingEnvironmentOperation> {
    return this.deadline(
      this.store.attempt(
        environmentRecoveryKey(operation.actor, operation.project),
        operation.request.operationId,
      ),
    );
  }
  remove(operation: PendingEnvironmentOperation): Promise<void> {
    return this.deadline(
      this.store.remove(
        environmentRecoveryKey(operation.actor, operation.project),
        operation.request.operationId,
        operation.definitiveRejection ? operation.attempts : undefined,
      ),
    );
  }
}
