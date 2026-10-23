import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  PendingTasks,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonList,
  IonNote,
  IonRadio,
  IonRadioGroup,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { ClassName, SneatBaseModalComponent } from '@sneat/ui';
import type { TypedValue } from '@sneat/datatug-semantic';
import type { IParameterDef } from '../../models/definition/parameter';
import {
  LOOKUP_PAGE_SIZE,
  lookupCellText,
  normalizeLookupFilter,
  pickedParameterValue,
} from './parameter-lookup-model';
import type {
  ParameterLookupPage,
  ParameterLookupProvider,
  ParameterLookupResult,
  ParameterLookupSourceOption,
} from './parameter-lookup-provider';

/**
 * The parameter lookup dialog (datatug/backstage spec/features/parameter-lookup,
 * REQ:dialog, REQ:dialog-states, REQ:accessible-picker): a searchbar, an
 * optional source chooser and a single-selection list of at most 50 rows,
 * filtered where the data is by the {@link ParameterLookupProvider}. Select
 * (or a double-click, or Enter on a row) dismisses with
 * {@link ParameterLookupResult}; Cancel, close and Escape dismiss with nothing.
 */
@Component({
  selector: 'sneat-datatug-parameter-lookup',
  templateUrl: './parameter-lookup.component.html',
  styleUrl: './parameter-lookup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: ClassName, useValue: 'ParameterLookupComponent' }],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonFooter,
    IonSearchbar,
    IonSelect,
    IonSelectOption,
    IonItem,
    IonList,
    IonNote,
    IonRadioGroup,
    IonRadio,
    IonSpinner,
  ],
})
export class ParameterLookupComponent
  extends SneatBaseModalComponent
  implements AfterViewInit, OnDestroy
{
  // Ionic's ModalController assigns componentProps as plain properties, which
  // would overwrite signal inputs; setter inputs keep the values in signals.
  private readonly parameterValue = signal<IParameterDef>({ id: '', type: 'string' });
  private readonly providerValue = signal<ParameterLookupProvider>({ subject: '', sources: [], search: () => Promise.reject(new Error('No lookup provider.')) });
  private readonly currentValueValue = signal<string | undefined>(undefined);

  @Input({ required: true }) set parameter(value: IParameterDef) {
    this.parameterValue.set(value);
  }
  get parameter(): IParameterDef {
    return this.parameterValue();
  }
  @Input({ required: true }) set provider(value: ParameterLookupProvider) {
    this.providerValue.set(value);
  }
  get provider(): ParameterLookupProvider {
    return this.providerValue();
  }
  /** The input's current value, preselected when it is listed. */
  @Input() set currentValue(value: string | undefined) {
    this.currentValueValue.set(value);
  }
  get currentValue(): string | undefined {
    return this.currentValueValue();
  }

  private readonly searchbar = viewChild('searchbar', { read: ElementRef<HTMLIonSearchbarElement> });

  readonly filter = signal('');
  readonly sourceId = signal<string | undefined>(undefined);
  readonly page = signal<ParameterLookupPage | undefined>(undefined);
  readonly loading = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly pickError = signal<string | undefined>(undefined);
  readonly selectedIndex = signal<number | undefined>(undefined);
  /** The sources offered; a provider's prepare step may narrow them on open. */
  readonly sourceOptions = signal<readonly ParameterLookupSourceOption[]>([]);
  readonly preparing = signal(false);
  readonly noUsableSource = signal<string | undefined>(undefined);
  /** True once the modal's enter animation is over, so focus is not undone by the overlay. */
  private readonly entered = signal(false);
  private focusApplied = false;
  private filterGone = false;

  private readonly pendingTasks = inject(PendingTasks);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private controller?: AbortController;
  private generation = 0;

  readonly subject = computed(() => this.providerValue().subject);
  readonly sourceNote = computed(() => this.providerValue().sourceNote);
  readonly meaningNote = computed(() => this.providerValue().meaningNote);
  readonly title = computed(() => `Find ${this.subject()}`);
  readonly needsSource = computed(() => this.sourceId() === undefined && !this.preparing() && !this.noUsableSource());
  /** The filter stays disabled until a source is known; a disabled input cannot take focus. */
  readonly filterDisabled = computed(() => this.needsSource() || this.preparing() || !!this.noUsableSource());
  readonly rows = computed(() => this.page()?.rows ?? []);
  readonly displayColumns = computed(() => this.page()?.columns ?? []);
  /** Key column first and narrower, then one equal share per display column. */
  readonly gridTemplate = computed(() =>
    // The first display column usually names the record (a company), so it gets the widest share.
    ['minmax(7.5rem, 0.6fr)', ...this.displayColumns().slice(1).map((_, i) => (i === 0 ? 'minmax(0, 1.5fr)' : 'minmax(0, 1fr)'))].join(' '),
  );
  readonly collection = computed(() => this.page()?.collection ?? this.subject());

  /** The single polite status line (REQ:accessible-picker live region). */
  readonly status = computed(() => {
    if (this.preparing()) return `Checking where to look up ${this.subject()}…`;
    const none = this.noUsableSource();
    if (none) return none;
    if (this.needsSource()) return `Choose where to look up ${this.subject()}.`;
    // While a newer filter loads, the old rows stay (dimmed) but their status must not speak for the new filter.
    if (this.loading()) return `Searching ${this.collection()}…`;
    const error = this.error();
    if (error) return error;
    const page = this.page();
    if (!page) return '';
    if (page.unavailable) return page.unavailable;
    const filter = this.filter();
    if (!page.rows.length)
      return filter ? `No ${page.collection} match "${filter}".` : `${page.collection} has no rows.`;
    if (page.limited)
      return page.limitNotice ?? `Showing the first ${LOOKUP_PAGE_SIZE} matches. Type to narrow the list.`;
    return `${page.rows.length} ${page.rows.length === 1 ? 'match' : 'matches'}.`;
  });

  readonly statusKind = computed<'info' | 'empty' | 'error' | 'unavailable'>(() => {
    if (this.error()) return 'error';
    if (this.noUsableSource()) return 'unavailable';
    const page = this.page();
    if (page?.unavailable) return 'unavailable';
    if (page && !page.rows.length && !this.loading()) return 'empty';
    return 'info';
  });

  constructor() {
    super();
    // Focus the filter once, when the dialog has entered AND the filter is enabled: a disabled
    // input ignores focus, so a keyboard user who types straight away would otherwise miss it.
    effect(() => {
      if (!this.entered() || this.filterDisabled() || this.focusApplied) return;
      this.focusApplied = true;
      // The enabled state reaches the native input on a later render; retry until it holds focus.
      setTimeout(() => this.focusFilter(0), 0);
    });
  }

  private focusFilter(attempt: number): void {
    const bar = this.searchbar()?.nativeElement;
    if (this.filterGone || !bar) return;
    void bar.setFocus?.();
    void bar.getInputElement?.()?.then((input: HTMLInputElement) => {
      if (input.ownerDocument.activeElement !== input && attempt < 10 && !this.filterGone)
        setTimeout(() => this.focusFilter(attempt + 1), 50);
    });
  }

  ngAfterViewInit(): void {
    // After the modal's enter animation; focusing earlier is undone by the overlay's own focus handling.
    setTimeout(() => this.entered.set(true), 350);
    const provider = this.providerValue();
    if (provider.prepare) void this.prepare(provider);
    else this.start(provider.sources, provider.preselectedSourceId);
  }

  private start(sources: readonly ParameterLookupSourceOption[], preselected: string | undefined): void {
    this.sourceOptions.set(sources);
    const id = preselected ?? (sources.length === 1 ? sources[0].id : undefined);
    if (id) this.sourceId.set(id);
    void this.load();
  }

  private async prepare(provider: ParameterLookupProvider): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.preparing.set(true);
    const done = this.pendingTasks.add();
    try {
      const prepare = provider.prepare;
      if (!prepare) return;
      const prepared = await prepare(controller.signal);
      if (controller.signal.aborted) return;
      this.preparing.set(false);
      if (prepared.unavailable) this.noUsableSource.set(prepared.unavailable);
      else this.start(prepared.sources, prepared.preselectedSourceId);
    } catch (e) {
      if (controller.signal.aborted) return;
      this.preparing.set(false);
      // Fall back to every offered source; each search explains its own problem.
      this.start(provider.sources, provider.preselectedSourceId);
      this.logError(e, 'Parameter lookup source check failed', { show: false });
    } finally {
      done();
    }
  }

  override ngOnDestroy(): void {
    this.filterGone = true;
    this.controller?.abort();
    super.ngOnDestroy();
  }

  onFilter(value: string | null | undefined): void {
    const next = normalizeLookupFilter(value);
    if (next === this.filter()) return;
    this.filter.set(next);
    void this.load();
  }

  clearFilter(): void {
    const bar = this.searchbar()?.nativeElement;
    if (bar) bar.value = '';
    this.onFilter('');
  }

  chooseSource(id: string | undefined): void {
    if (!id || id === this.sourceId()) return;
    this.sourceId.set(id);
    this.page.set(undefined);
    void this.load();
  }

  retry(): void {
    void this.load();
  }

  /** Runs the latest search; an older one is aborted and its reply discarded. */
  async load(): Promise<void> {
    const sourceId = this.sourceId();
    this.controller?.abort();
    const generation = ++this.generation;
    if (!sourceId) return;
    const controller = new AbortController();
    this.controller = controller;
    this.loading.set(true);
    this.error.set(undefined);
    this.pickError.set(undefined);
    const done = this.pendingTasks.add();
    try {
      const page = await this.providerValue().search(sourceId, this.filter(), controller.signal);
      if (generation !== this.generation) return;
      this.page.set(page);
      const current = this.currentValueValue();
      const index = current === undefined || current === ''
        ? -1
        : page.rows.findIndex((row) => lookupCellText(row[0]) === current);
      this.selectedIndex.set(index >= 0 ? index : undefined);
      if (index >= 0) this.scrollRowIntoView(index);
    } catch (e) {
      if (generation !== this.generation) return;
      // Only this search's own cancellation is silent; any other abort is a failure to show.
      if (controller.signal.aborted) return;
      this.page.set(undefined);
      this.selectedIndex.set(undefined);
      this.error.set(`The lookup could not read ${this.collection()}.`);
      this.logError(e, 'Parameter lookup failed', { show: false });
    } finally {
      if (generation === this.generation) this.loading.set(false);
      done();
    }
  }

  /** Brings the preselected current value into view once its row has rendered. */
  private scrollRowIntoView(index: number): void {
    setTimeout(() => {
      const row = this.host.nativeElement.querySelectorAll<HTMLElement>('[data-testid="parameter-lookup-row"]')[index];
      row?.scrollIntoView?.({ block: 'nearest' });
    }, 0);
  }

  onSelectionChange(value: unknown): void {
    const index = typeof value === 'number' ? value : Number(value);
    this.selectedIndex.set(Number.isInteger(index) && index >= 0 ? index : undefined);
    this.pickError.set(undefined);
  }

  /** Enter on a focused row picks it. */
  onListKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    const radio = (event.target as HTMLElement | null)?.closest?.('ion-radio') as (HTMLElement & { value?: unknown }) | null;
    const value = radio?.value;
    if (value === undefined) return;
    event.preventDefault();
    this.onSelectionChange(value);
    this.select();
  }

  pickRow(index: number): void {
    this.onSelectionChange(index);
    this.select();
  }

  select(): void {
    const index = this.selectedIndex();
    const key = index === undefined ? undefined : this.rows()[index]?.[0];
    if (!key) return;
    const checked = pickedParameterValue(this.parameterValue(), key);
    if ('error' in checked) {
      this.pickError.set(checked.error);
      return;
    }
    const result: ParameterLookupResult = { value: key };
    this.dismissModal(result, 'select');
  }

  cancel(): void {
    this.dismissModal(undefined, 'cancel');
  }

  cellText(value: TypedValue | undefined): string {
    return lookupCellText(value);
  }

  /** A short accessible name for one row: its cells joined. */
  rowLabel(row: readonly TypedValue[]): string {
    return row.map((cell) => lookupCellText(cell)).filter(Boolean).join(', ');
  }
}
