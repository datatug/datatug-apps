// READ-ONLY BY CONSTRUCTION — this page only ever calls
// `SpaceExplorerService.watchDocument$`/`watchCollection$`, which in turn
// only ever call Firestore's read APIs (`docData`/`collectionData`). Never
// add a write call (`setDoc`/`updateDoc`/`deleteDoc`/`addDoc`) here — this is
// the "explore your own raw data" transparency viewer
// (backstage/docs/roadmaps/datatug-transparency-explorer.md), not an editor.
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { catchError, defer, map, of, switchMap } from 'rxjs';
import { routingParamSpaceId } from '../../../core/datatug-routing-params';
import {
  IExploreCollectionItem,
  IExploreDoc,
  SpaceExplorerService,
} from '../../../services/repo/space-explorer.service';
import {
  KNOWN_EXT_MODULES,
  KNOWN_MODULE_COLLECTIONS,
  KNOWN_SPACE_DOC_COLLECTIONS,
} from './space-explorer-known-collections';

interface IBreadcrumb {
  readonly label: string;
  readonly depth: number; // subPath length this breadcrumb navigates to
}

@Component({
  selector: 'sneat-datatug-space-explorer-page',
  templateUrl: './space-explorer-page.component.html',
  styleUrls: ['./space-explorer-page.component.scss'],
  providers: [SpaceExplorerService],
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonIcon,
    IonButton,
    IonInput,
    IonSpinner,
    IonBadge,
    IonNote,
  ],
})
export class SpaceExplorerPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly explorer = inject(SpaceExplorerService);

  /** The one space this viewer is rooted at — a route param for this PoC. */
  protected readonly spaceId = toSignal(
    this.route.paramMap.pipe(
      map((params) => params.get(routingParamSpaceId) ?? ''),
    ),
    { initialValue: '' },
  );

  /** Path below `spaces/{spaceId}`, e.g. `['ext', 'contactus', 'contacts']`. */
  protected readonly subPath = signal<string[]>([]);

  /** Full Firestore path segments, always rooted at `spaces/{spaceId}`. */
  protected readonly pathSegments = computed(() => [
    'spaces',
    this.spaceId(),
    ...this.subPath(),
  ]);

  /** Firestore paths alternate: odd length = collection, even = document. */
  protected readonly nodeKind = computed<'collection' | 'document'>(() =>
    this.pathSegments().length % 2 === 0 ? 'document' : 'collection',
  );

  protected readonly breadcrumbs = computed<IBreadcrumb[]>(() => {
    const spaceId = this.spaceId();
    const crumbs: IBreadcrumb[] = [{ label: `space: ${spaceId}`, depth: 0 }];
    this.subPath().forEach((segment, i) =>
      crumbs.push({ label: segment, depth: i + 1 }),
    );
    return crumbs;
  });

  /** Well-known collection-name shortcuts to descend into from this doc — see
   * `space-explorer-known-collections.ts` for why this can't be a real,
   * complete list (the client SDK can't enumerate subcollections). */
  protected readonly suggestedCollections = computed<string[]>(() => {
    const sub = this.subPath();
    if (sub.length === 0) {
      return [...KNOWN_SPACE_DOC_COLLECTIONS];
    }
    if (sub.length === 2 && sub[0] === 'ext') {
      return [...KNOWN_MODULE_COLLECTIONS];
    }
    if (sub.length === 1 && sub[0] === 'ext') {
      return [...KNOWN_EXT_MODULES];
    }
    return [];
  });

  protected readonly customSegment = signal('');
  protected readonly error = signal<string | undefined>(undefined);

  private readonly pathSegments$ = toObservable(this.pathSegments);

  protected readonly currentDoc = toSignal<IExploreDoc | undefined>(
    this.pathSegments$.pipe(
      switchMap((segments) => {
        this.error.set(undefined);
        if (segments.length % 2 !== 0 || !segments[1]) {
          return of(undefined);
        }
        // `defer()` so a synchronous throw inside the SDK call (e.g. an
        // invalid path segment) lands in `catchError` instead of killing the
        // whole `toSignal` subscription (which would leave the page dead
        // until a full reload).
        return defer(() => this.explorer.watchDocument$(segments)).pipe(
          catchError((err) => {
            this.error.set(errorMessage(err));
            return of(undefined);
          }),
        );
      }),
    ),
  );

  protected readonly currentCollection = toSignal<
    IExploreCollectionItem[] | undefined
  >(
    this.pathSegments$.pipe(
      switchMap((segments) => {
        this.error.set(undefined);
        if (segments.length % 2 !== 1) {
          return of(undefined);
        }
        // See the `defer()` comment on `currentDoc` above.
        return defer(() => this.explorer.watchCollection$(segments)).pipe(
          catchError((err) => {
            this.error.set(errorMessage(err));
            return of(undefined);
          }),
        );
      }),
    ),
  );

  protected goToBreadcrumb(depth: number): void {
    this.subPath.set(this.subPath().slice(0, depth));
  }

  protected openDoc(docId: string): void {
    this.subPath.set([...this.subPath(), docId]);
  }

  protected openCollection(collectionName: string): void {
    const name = collectionName.trim();
    if (!name) {
      return;
    }
    // A path segment must be a single Firestore segment: a pasted path like
    // `ext/contactus` would throw synchronously inside the Firestore SDK.
    if (name.includes('/')) {
      this.error.set(
        `"${name}" is not a valid collection name — enter one path segment at a time (no "/").`,
      );
      return;
    }
    this.subPath.set([...this.subPath(), name]);
    this.customSegment.set('');
  }

  protected addCustomSegment(): void {
    this.openCollection(this.customSegment());
  }

  protected jsonOf(data: Record<string, unknown> | undefined): string {
    return JSON.stringify(data ?? null, null, 2);
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
