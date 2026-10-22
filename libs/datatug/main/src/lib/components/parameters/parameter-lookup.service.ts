import { Injectable, Injector, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import type { IParameterDef } from '../../models/definition/parameter';
import { AgentService } from '../../services/repo/agent.service';
import { ParameterLookupComponent } from './parameter-lookup.component';
import {
  EXPLICIT_LOOKUP_MAX_ROWS,
  LOOKUP_PAGE_SIZE,
  humanizeName,
  isScalarLookupParameter,
  rawCellToTypedValue,
  rowMatchesFilter,
} from './parameter-lookup-model';
import type {
  ParameterLookupContext,
  ParameterLookupPage,
  ParameterLookupProvider,
  ParameterLookupResult,
} from './parameter-lookup-provider';
import { PublicParameterLookupService } from './public-parameter-lookup.service';

/** The local agent an explicit (author SQL) lookup runs on. */
export interface ExplicitLookupAgent {
  readonly storeId: string;
  readonly projectId: string;
  readonly envId: string;
}

export interface ParameterLookupHost extends ParameterLookupContext {
  /** Set only where an explicit `lookup` may run (an unqualified local-agent project). */
  readonly explicitAgent?: ExplicitLookupAgent;
}

/**
 * Opens the parameter lookup dialog (datatug/backstage
 * spec/features/parameter-lookup) for a parameter, choosing the provider:
 * an explicit `lookup` (legacy override, local agent only) or the parameter's
 * `meta` meaning (public browser runtime). Provide it beside the component
 * that uses it, together with {@link AgentService}.
 */
@Injectable()
export class ParameterLookupService {
  // Resolved on first use: most parameters never need a lookup, and hosts
  // render this service's button for every parameter input.
  private readonly injector = inject(Injector);
  private get modal(): ModalController {
    return this.injector.get(ModalController);
  }
  private get agentService(): AgentService {
    return this.injector.get(AgentService);
  }
  private get publicLookup(): PublicParameterLookupService {
    return this.injector.get(PublicParameterLookupService);
  }

  /** Whether the parameter gets a pick button on this host. Never downloads a fixture. */
  async isAvailable(parameter: IParameterDef, host: ParameterLookupHost): Promise<boolean> {
    return (await this.availability(parameter, host)).available;
  }

  /**
   * Whether the parameter gets a pick button, and whether its meaning was
   * inferred from its name (REQ:inferred-parameter-meaning), so the button can say so.
   */
  async availability(parameter: IParameterDef, host: ParameterLookupHost): Promise<{ available: boolean; inferred: boolean }> {
    if (parameter.lookup)
      return { available: !!host.explicitAgent && !!parameter.lookup.db && !!parameter.lookup.keyFields?.length, inferred: false };
    if (!isScalarLookupParameter(parameter)) return { available: false, inferred: false };
    const sources = await this.publicLookup.sources(parameter, host);
    return { available: sources.length > 0, inferred: sources[0]?.meaning.provenance === 'inferred' };
  }

  /** The open dialog, so a host that goes away can close it ({@link closeOpen}). */
  private openModal?: HTMLIonModalElement;
  /** Set when the host went away: a dialog still being prepared must not open over a gone page. */
  private disposed = false;

  /** The host is gone: close an open dialog and never open one that is still being prepared. */
  dispose(): void {
    this.disposed = true;
    this.closeOpen();
  }

  /** Closes a dialog this service opened and is still showing. */
  closeOpen(): void {
    void this.openModal?.dismiss(undefined, 'cancel');
    this.openModal = undefined;
  }

  /** Opens the dialog; resolves with the picked key, or undefined when cancelled or unavailable. */
  async open(parameter: IParameterDef, host: ParameterLookupHost, currentValue?: string): Promise<ParameterLookupResult | undefined> {
    if (this.disposed) return undefined;
    const provider = await this.provider(parameter, host);
    if (!provider) return undefined;
    if (this.disposed) {
      provider.dispose?.();
      return undefined;
    }
    try {
      const modal = await this.modal.create({
        component: ParameterLookupComponent,
        componentProps: { parameter, provider, currentValue },
        cssClass: 'parameter-lookup-modal',
      });
      if (this.disposed) return undefined;
      this.openModal = modal;
      await modal.present();
      // present() resolves after the enter animation, when the overlay no longer moves focus itself.
      void (modal.querySelector?.('ion-searchbar') as HTMLIonSearchbarElement | null)?.setFocus?.();
      const { data, role } = await modal.onWillDismiss<ParameterLookupResult>();
      if (this.openModal === modal) this.openModal = undefined;
      return role === 'select' && data?.value ? data : undefined;
    } finally {
      // The dialog's fixture and SQLite worker live only as long as the dialog.
      provider.dispose?.();
    }
  }

  private async provider(parameter: IParameterDef, host: ParameterLookupHost): Promise<ParameterLookupProvider | undefined> {
    if (parameter.lookup) {
      return host.explicitAgent ? this.explicitProvider({ ...parameter, lookup: parameter.lookup }, host.explicitAgent) : undefined;
    }
    const sources = await this.publicLookup.sources(parameter, host);
    if (!sources.length || !host.projectRef) return undefined;
    const { entity: entityId, field } = sources[0].meaning;
    const entity = await this.publicLookup.entity(host.projectRef, entityId);
    return this.publicLookup.provider({ ...parameter, meta: { entity: entityId, field } }, host, sources, entity);
  }

  /**
   * The author's SQL runs once on the local agent; the dialog filters its
   * first 1,000 rows in the page (REQ:explicit-lookup-override).
   */
  private explicitProvider(parameter: IParameterDef & { lookup: NonNullable<IParameterDef['lookup']> }, agent: ExplicitLookupAgent): ParameterLookupProvider {
    const lookup = parameter.lookup;
    const label = parameter.title || parameter.id;
    let rows: Promise<{ columns: string[]; rows: Record<string, unknown>[] }> | undefined;
    const read = () => {
      rows ??= firstValueFrom(this.agentService.select(agent.storeId, {
        proj: agent.projectId,
        env: agent.envId,
        db: lookup.db,
        sql: lookup.sql,
        limit: EXPLICIT_LOOKUP_MAX_ROWS + 1,
      })).catch((e) => {
        rows = undefined;
        throw e;
      });
      return rows;
    };
    const keyField = lookup.keyFields[0];
    return {
      subject: label,
      sources: [{ id: lookup.db, label: lookup.db }],
      preselectedSourceId: lookup.db,
      sourceNote: 'Rows of the lookup query saved with this parameter.',
      search: async (_sourceId, filter, signal): Promise<ParameterLookupPage> => {
        const response = await read();
        signal.throwIfAborted();
        const others = response.columns.filter((c) => c !== keyField).slice(0, 6);
        const all = response.rows.slice(0, EXPLICIT_LOOKUP_MAX_ROWS)
          .map((row) => [keyField, ...others].map((c) => rawCellToTypedValue(row[c])));
        const matched = all.filter((cells) => rowMatchesFilter(cells, filter));
        const scanLimited = response.rows.length > EXPLICIT_LOOKUP_MAX_ROWS;
        return {
          collection: label,
          columns: [
            { name: keyField, label: humanizeName(keyField), key: true },
            ...others.map((c) => ({ name: c, label: humanizeName(c), key: false })),
          ],
          rows: matched.slice(0, LOOKUP_PAGE_SIZE),
          limited: matched.length > LOOKUP_PAGE_SIZE || scanLimited,
          ...(scanLimited ? { limitNotice: `Filtering the first ${EXPLICIT_LOOKUP_MAX_ROWS} rows of the lookup query.` } : {}),
        };
      },
    };
  }
}
