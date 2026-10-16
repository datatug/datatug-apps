import { computed, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SneatAuthStateService } from '@sneat/auth-core';
import { IProjectRef } from '../../core/project-context';
import { of } from 'rxjs';

export interface BoardChoices {
  readonly favorite: boolean;
  readonly selectedQueryId?: string;
}

/** Device preferences only. A saved choice never grants board or query access. */
@Injectable({ providedIn: 'root' })
export class BoardChoicesService {
  private readonly authState = toSignal(
    inject(SneatAuthStateService, { optional: true })?.authState ??
      of({ status: 'authenticating' as const }),
    {
      initialValue: undefined,
    },
  );
  private readonly revision = signal(0);
  readonly actor = computed(() => {
    const auth = this.authState();
    if (auth?.status === 'authenticated') return auth.user?.uid || undefined;
    if (auth?.status === 'notAuthenticated') return 'anonymous';
    return undefined;
  });

  canPersist(ref: IProjectRef | undefined): boolean {
    // A local agent may represent a different OS/CLI principal in the same
    // browser profile. Browser auth does not attest that principal.
    return !!ref && ref.projectApi !== 'local' && ref.storeId !== 'agent';
  }

  private key(ref: IProjectRef, boardId: string): string | undefined {
    if (!this.canPersist(ref)) return undefined;
    const actor = this.actor();
    if (!actor || !boardId) return undefined;
    return JSON.stringify([
      'datatug-board-choices/1',
      actor,
      ref.storeId,
      ref.spaceID || '',
      ref.projectId,
      ref.projectApi || '',
      ref.branch || '',
      boardId,
    ]);
  }

  read(
    ref: IProjectRef | undefined,
    boardId: string | undefined,
  ): BoardChoices {
    this.revision();
    if (!ref || !boardId) return { favorite: false };
    const key = this.key(ref, boardId);
    if (!key) return { favorite: false };
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) || 'null');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return { favorite: false };
      const value = raw as Record<string, unknown>;
      return {
        favorite: value['favorite'] === true,
        ...(typeof value['selectedQueryId'] === 'string' &&
        value['selectedQueryId'].length <= 256
          ? { selectedQueryId: value['selectedQueryId'] }
          : {}),
      };
    } catch {
      return { favorite: false };
    }
  }

  private save(ref: IProjectRef, boardId: string, next: BoardChoices): boolean {
    const key = this.key(ref, boardId);
    if (!key) return false;
    try {
      localStorage.setItem(key, JSON.stringify(next));
      this.revision.update((value) => value + 1);
      return true;
    } catch {
      return false;
    }
  }

  setFavorite(ref: IProjectRef, boardId: string, favorite: boolean): boolean {
    return this.save(ref, boardId, { ...this.read(ref, boardId), favorite });
  }

  selectQuery(ref: IProjectRef, boardId: string, queryId: string): boolean {
    if (!queryId || queryId.length > 256) return false;
    return this.save(ref, boardId, {
      ...this.read(ref, boardId),
      selectedQueryId: queryId,
    });
  }
}
