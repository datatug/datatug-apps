import {
  EnvironmentInjector,
  Injectable,
  computed,
  createEnvironmentInjector,
  effect,
  inject,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import {
  SOURCE_UI_SCOPE,
  type SourceAction,
  type SourceActionField,
  type SourceAdapterRegistration,
  type SourceFieldValue,
  type SourceInteraction,
  type SourceUiEvent,
  type SourceUiScope,
  type SourceWorkspaceController,
  type SourceWorkspaceView,
} from '../source-workspace/source-workspace-contract';
import { projectPageHref } from '../nav/project-page-href';
import { DetectiveClientService } from '../detective/detective-client.service';
import { isSharedProjectRef } from '../core/project-context';
import { ShippingComponentApiService } from './shipping-component-api.service';
import { SHIPPING_SOURCE, ShippingApiService } from './shipping-api.service';
import { ShippingWorkspaceController } from './shipping-workspace.controller';
import { ShippingPublicationController } from './shipping-publication.controller';
import { ShippingInstallationController } from './shipping-installation.controller';
import { ShippingHistoryController } from './shipping-history.controller';
import { SemanticBrowserComponent } from '../semantic-browser/semantic-browser.component';
import { NativeSemanticBrowserController } from './native-semantic-browser.controller';

/** Protocol adapter only: no domain template/component or singleton mutable source state. */
@Injectable({ providedIn: 'root' })
export class ShippingSourceAdapterService {
  private readonly parent = inject(EnvironmentInjector);
  private readonly detective = inject(DetectiveClientService);
  private readonly components = inject(ShippingComponentApiService);
  private readonly router = inject(Router);
  private readonly shipping = inject(ShippingApiService);
  readonly registration: SourceAdapterRegistration = {
    sourceId: SHIPPING_SOURCE,
    // The synthetic working copy's own time: workspace_state.business_clock, read under current rights.
    businessClock: async (scope, abort) => {
      const revision = await firstValueFrom(
        this.shipping
          .revision(scope.projectRef)
          .pipe(takeUntil(fromEvent(abort, 'abort'))),
      );
      abort.throwIfAborted();
      return { label: 'Demo clock', at: revision.businessClock };
    },
    discover: async (scope, abort) => {
      if (
        !isSharedProjectRef(scope.projectRef) ||
        scope.projectRef.branch ||
        scope.projectRef.projectApi
      )
        return undefined;
      const context = {
        kind: 'cloud' as const,
        storage: 'firestore' as const,
        spaceID: scope.projectRef.spaceID,
        project: scope.projectRef.projectId,
        principal: scope.actor,
      };
      const [state] = await Promise.all([
        firstValueFrom(
          this.detective
            .state(context)
            .pipe(takeUntil(fromEvent(abort, 'abort'))),
        ),
        firstValueFrom(
          this.components
            .current(scope.projectRef)
            .pipe(takeUntil(fromEvent(abort, 'abort'))),
        ),
      ]);
      abort.throwIfAborted();
      if (state.capabilities.canRead !== true) return undefined;
      return {
        title: 'Shipping working copy',
        description:
          'Isolated synthetic source · current owner access verified',
      };
    },
    create: (scope, abort) => this.create(scope, abort),
  };
  create(scope: SourceUiScope, abort: AbortSignal): ShippingSourceController {
    if (
      scope.sourceId !== SHIPPING_SOURCE ||
      !isSharedProjectRef(scope.projectRef) ||
      scope.projectRef.branch ||
      scope.projectRef.projectApi
    )
      throw new Error('Unsupported source scope.');
    abort.throwIfAborted();
    const child = createEnvironmentInjector(
      [
        { provide: SOURCE_UI_SCOPE, useValue: scope },
        ShippingWorkspaceController,
        ShippingPublicationController,
        ShippingInstallationController,
        ShippingHistoryController,
        NativeSemanticBrowserController,
      ],
      this.parent,
    );
    const workspace = child.get(ShippingWorkspaceController),
      publication = child.get(ShippingPublicationController),
      installation = child.get(ShippingInstallationController),
      history = child.get(ShippingHistoryController),
      semantic = child.get(NativeSemanticBrowserController);
    if (workspace.page.identity() !== scope.identity) {
      child.destroy();
      throw new Error('Source scope changed.');
    }
    let destroyed = false;
    const destroy = () => {
      if (!destroyed) {
        destroyed = true;
        child.destroy();
      }
    };
    abort.addEventListener('abort', destroy, { once: true });
    const review = signal<
        { interaction: SourceInteraction; fence: string } | undefined
      >(undefined),
      notice = signal('');
    const current = () =>
      !destroyed &&
      !abort.aborted &&
      workspace.page.identity() === scope.identity;
    const fence = () =>
      JSON.stringify([
        scope,
        workspace.revision(),
        publication.current(),
        installation.state(),
      ]);
    runInInjectionContext(child, () =>
      effect(() => {
        const names = workspace.environments();
        publication.environments.set(names);
        history.environments.set(names);
        semantic.environments.set(
          names.filter(
            (name) => !scope.environment || name === scope.environment,
          ),
        );
        semantic.canWrite.set(workspace.canWrite());
        publication.canWrite.set(workspace.canWrite());
        if (scope.environment && names.includes(scope.environment)) {
          if (!publication.environment() && !publication.pending())
            publication.chooseEnvironment(scope.environment);
          if (!history.environment())
            history.chooseEnvironment(scope.environment);
        }
      }),
    );
    runInInjectionContext(child, () =>
      effect(() => {
        if (workspace.readDenied()) history.clearAccess();
      }),
    );
    const environmentField = (label: string): SourceActionField => ({
      id: 'environment',
      label,
      type: 'string',
      required: true,
      choices: workspace
        .environments()
        .filter((name) => !scope.environment || name === scope.environment)
        .map((name) => ({ label: name, value: name })),
    });
    const pending = (): SourceInteraction | undefined => {
      const action = workspace.pending();
      if (action)
        return {
          reviewId: action.operationId,
          actionId: 'working-copy:original',
          title: 'Working-copy operation',
          description: `${action.action}${action.orderId ? ' · order ' + action.orderId : ''}. The original operation and expected revision are retained. A previous delivery may already have completed.`,
          phase: workspace.conflict() ? 'conflict' : 'uncertain',
          fields: [],
          submitLabel: '',
          enabled: workspace.canWrite() && !workspace.loading(),
          retryLabel: 'Retry original operation',
          conflictLabel: 'I reviewed the conflict',
        };
      const access = publication.pending();
      if (access)
        return {
          reviewId: access.intent.operationId,
          actionId: 'query-access:original',
          title: 'Query-access operation',
          description: `${access.intent.environment} · original operation and expected publication revision retained. A receipt is not the current grant.`,
          phase: access.conflict ? 'conflict' : 'uncertain',
          fields: [],
          submitLabel: '',
          enabled:
            publication.canWrite() &&
            publication.authReady() &&
            !!publication.current() &&
            (!scope.environment ||
              scope.environment === access.intent.environment),
          retryLabel: 'Retry original query-access operation',
          conflictLabel: 'I reviewed the conflict',
        };
      const install = installation.pending();
      if (install)
        return {
          reviewId: install.intent.operationId,
          actionId: 'installation:original',
          title: 'Content installation',
          description:
            install.phase === 'acknowledged'
              ? 'Installation acknowledged. Refresh to verify its current state.'
              : 'Original operation and component version retained; a previous delivery may already have completed.',
          phase: install.phase,
          fields: [],
          submitLabel: '',
          enabled:
            workspace.canWrite() &&
            installation.currentAuthorized() &&
            !installation.journalInvalid(),
          retryLabel: 'Retry original installation',
          conflictLabel: 'Reviewed conflict; prepare new install',
        };
      return undefined;
    };
    const actions = (): SourceAction[] => {
      if (!current()) return [];
      const writable = workspace.canWrite(),
        revision = workspace.revision();
      const items: SourceAction[] = [
        ...(!revision
          ? [
              {
                id: 'working-copy:initialize',
                title: 'Initialize working copy',
                enabled: writable && !workspace.loading(),
                description:
                  'No current revision could be confirmed. Initialize asks the server to create a copy only if none exists; it never replaces an existing copy.',
              },
            ]
          : [
              {
                id: 'working-copy:correct',
                title: 'Correct routing configuration',
                enabled: writable,
              },
              {
                id: 'working-copy:replay',
                title: 'Replay selected order',
                enabled: writable,
                description:
                  'Explicitly process one offered order using the current configuration.',
              },
              {
                id: 'working-copy:reset',
                title: 'Reset working copy…',
                enabled: writable,
                description:
                  'Starts a new generation. Original evidence keeps its original generation.',
              },
            ]),
        {
          id: 'query-access:environment',
          title: 'Choose query-access environment',
          enabled:
            workspace.environments().length > 0 && !publication.pending(),
        },
        {
          id: 'activity:environment',
          title: 'Choose activity environment',
          enabled: workspace.environments().length > 0,
        },
      ];
      const access = publication.current(),
        recoveryReason = publication.recoveryBlocked()
          ? 'An original query-access operation belongs to another environment. Return there to review its uncertain delivery.'
          : undefined;
      if (access)
        items.push(
          {
            id: 'query-access:enable',
            title: 'Enable query access',
            unavailableReason: recoveryReason,
            enabled:
              !publication.recoveryBlocked() &&
              writable &&
              publication.authReady() &&
              !publication.enabled() &&
              !publication.atCapacity(),
          },
          {
            id: 'query-access:disable',
            title: 'Disable query access',
            unavailableReason: recoveryReason,
            enabled:
              !publication.recoveryBlocked() &&
              writable &&
              publication.authReady() &&
              publication.enabled() &&
              !publication.atCapacity(),
          },
        );
      if (installation.state()?.exists === false)
        items.push({
          id: 'installation:install',
          title: 'Install investigation content',
          enabled:
            writable &&
            installation.currentAuthorized() &&
            !installation.journalInvalid() &&
            (!scope.environment || scope.environment === 'demo'),
          description:
            'Adds the pinned saved queries, Check, entities and board in demo without overwriting existing definitions.',
        });
      return items;
    };
    const link = (label: string, parts: string[], environment?: string) => {
      const destination = this.router.parseUrl(
        projectPageHref(scope.projectRef, parts),
      );
      if (environment)
        destination.queryParams = {
          ...destination.queryParams,
          [parts[0] === 'query' ? 'env' : 'environment']: environment,
        };
      return { label, destination };
    };
    const view = computed<SourceWorkspaceView>(() => {
      const revision = workspace.revision(),
        access = publication.current(),
        installed = installation.currentAuthorized()
          ? installation.state()?.installation
          : undefined,
        target = history.target();
      const denied = workspace.readDenied() || !current();
      const activeReview = review();
      const facts = [
        ...(revision
          ? [
              {
                label: 'Routing configuration',
                value: String(revision.configuration),
              },
              { label: 'Generation', value: revision.generation },
              { label: 'Revision', value: String(revision.revision) },
              {
                label: 'SHA-256',
                value: revision.sha256,
                kind: 'hash' as const,
              },
              ...revision.artifacts.map((a) => ({
                label: a.id,
                value: a.sha256,
                kind: 'hash' as const,
              })),
            ]
          : []),
        ...(access
          ? [
              {
                label: 'Query access',
                value: `${publication.environment()} · ${access.exists ? (access.publication.enabled ? 'enabled' : 'disabled') : 'not published'}`,
              },
              ...(access.exists
                ? [
                    {
                      label: 'Publication revision',
                      value: String(access.publication.revision),
                    },
                  ]
                : []),
            ]
          : []),
        ...(installed
          ? [{ label: 'Content installation', value: 'Installed' }]
          : []),
      ];
      return {
        title: 'Shipping working copy',
        description:
          'Prepare an isolated working copy, then explicitly publish query access. Configuration correction alone does not create a carrier assignment; replay is separate.',
        loading:
          workspace.loading() ||
          installation.loading() ||
          publication.loading(),
        busy: workspace.busy() || publication.busy() || installation.busy(),
        error: [workspace.error(), publication.error(), installation.error()]
          .filter(Boolean)
          .join(' '),
        notice: [notice(), workspace.notice(), publication.notice()]
          .filter(Boolean)
          .join(' '),
        actions: denied ? [] : actions(),
        interaction: denied
          ? undefined
          : pending() ||
            (activeReview
              ? {
                  ...activeReview.interaction,
                  enabled: actions().some(
                    (action) =>
                      action.id === activeReview.interaction.actionId &&
                      action.enabled,
                  ),
                }
              : undefined),
        current: denied
          ? undefined
          : {
              title: 'Current source state',
              sections: [{ title: 'Observed state', facts }],
            },
        links: [
          link('Sessions', ['sessions']),
          link('Incidents', ['incidents']),
          ...(!denied && installed
            ? [
                ...installed.boardIds.map((id) =>
                  link('Open board · ' + id, ['board', id], 'demo'),
                ),
                ...installed.queryIds.map((id) =>
                  link('Open query · ' + id, ['query', id], 'demo'),
                ),
                ...installed.checkIds.map((id) =>
                  link('Open Check · ' + id, ['checks', id], 'demo'),
                ),
              ]
            : []),
        ],
        activity: denied
          ? undefined
          : {
              heading: 'Shipping activity',
              actionLabel: 'Activity',
              listLabel: 'Source operations',
              loadingMessage: 'Loading source history…',
              emptyMessage:
                'No source operations were returned for this account and environment.',
              items: history.activityItems(),
              loading: history.loading(),
              enabled: !!history.environment(),
              error: history.error(),
              notice: history.notice(),
            },
        ...(!denied && target
          ? { retainedEvidence: { target, environment: history.environment() } }
          : {}),
        ...(!denied && workspace.native()
          ? {
              browser: {
                component: SemanticBrowserComponent,
                inputs: { model: semantic },
              },
            }
          : {}),
      };
    });
    const validate = (
      fields: readonly SourceActionField[],
      values: Readonly<Record<string, SourceFieldValue>>,
    ) => {
      if (
        Object.keys(values).some(
          (id) => !fields.some((field) => field.id === id),
        )
      )
        throw new Error('Unsupported action values.');
      for (const field of fields) {
        const value = Object.hasOwn(values, field.id)
          ? values[field.id]
          : undefined;
        if (!value) {
          if (field.required)
            throw new Error('Required action input unavailable.');
          continue;
        }
        if (
          Object.keys(value).some((key) => !['type', 'value'].includes(key)) ||
          value.type !== field.type ||
          typeof value.value !== 'string' ||
          value.value.length > 4096 ||
          (field.type === 'integer' &&
            !/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value.value)) ||
          (field.choices &&
            !field.choices.some((choice) => choice.value === value.value))
        )
          throw new Error('Unsupported action input.');
      }
    };
    const handle = async (event: SourceUiEvent) => {
      if (!current()) return;
      if (event.type === 'refresh') {
        workspace.refresh();
        publication.refresh();
        await installation.refresh();
        return;
      }
      if (workspace.readDenied()) return;
      if (event.type === 'load-activity') {
        await history.load();
        return;
      }
      if (event.type === 'open-activity') {
        history.openActivity(event.itemId);
        return;
      }
      if (event.type === 'close-details') {
        history.selected.set(undefined);
        return;
      }
      if (view().busy || view().loading) return;
      if (event.type === 'cancel-review') {
        review.set(undefined);
        return;
      }
      if (event.type === 'retry-original') {
        const held = pending();
        if (!held?.enabled || held.phase !== 'uncertain') return;
        if (workspace.pending()) await workspace.send();
        else if (publication.pending()) await publication.send();
        else if (installation.pending()) await installation.send();
        return;
      }
      if (event.type === 'review-conflict') {
        const held = pending();
        if (!held?.enabled || held.phase !== 'conflict') return;
        if (workspace.pending()) workspace.reviewConflict();
        else if (publication.pending()) publication.reviewConflict();
        else if (installation.pending()) installation.reviewConflict();
        return;
      }
      if (event.type === 'prepare-action') {
        if (
          pending() ||
          review() ||
          !actions().some((a) => a.id === event.actionId && a.enabled)
        )
          return;
        const fields =
          event.actionId === 'working-copy:replay'
            ? [
                {
                  id: 'order',
                  label: 'Order',
                  type: 'integer' as const,
                  required: true,
                  choices: [
                    { label: '11045', value: '11045' },
                    { label: '11062', value: '11062' },
                  ],
                },
              ]
            : event.actionId.endsWith(':environment')
              ? [environmentField('Environment')]
              : [];
        const action = actions().find((a) => a.id === event.actionId);
        if (!action) return;
        review.set({
          fence: fence(),
          interaction: {
            reviewId: crypto.randomUUID(),
            actionId: action.id,
            title: action.title,
            description:
              action.description ||
              'Review this explicit action against the current observed source state.',
            phase: 'review',
            fields,
            enabled: true,
            submitLabel:
              action.id === 'working-copy:reset'
                ? 'Confirm reset'
                : 'Confirm action',
            cancelLabel: 'Cancel',
          },
        });
        return;
      }
      if (event.type === 'submit-action') {
        const held = review();
        if (!held || held.interaction.actionId !== event.actionId || pending())
          return;
        if (held.fence !== fence()) {
          review.set(undefined);
          notice.set(
            'Source state changed. Review the current state and prepare the action again.',
          );
          return;
        }
        if (!actions().some((a) => a.id === event.actionId && a.enabled))
          return;
        validate(held.interaction.fields, event.values);
        review.set(undefined);
        if (event.actionId === 'query-access:environment') {
          publication.chooseEnvironment(event.values['environment'].value);
          return;
        }
        if (event.actionId === 'activity:environment') {
          history.chooseEnvironment(event.values['environment'].value);
          return;
        }
        if (
          event.actionId === 'query-access:enable' ||
          event.actionId === 'query-access:disable'
        ) {
          publication.prepare(event.actionId === 'query-access:enable');
          return;
        }
        if (event.actionId === 'installation:install') {
          installation.install();
          return;
        }
        if (event.actionId === 'working-copy:replay') {
          const order = event.values['order'].value;
          if (order !== '11045' && order !== '11062')
            throw new Error('Unsupported replay order.');
          workspace.prepare('replay', order === '11045' ? 11045 : 11062);
          return;
        }
        if (event.actionId === 'working-copy:initialize')
          workspace.prepare('initialize');
        if (event.actionId === 'working-copy:correct')
          workspace.prepare('correct');
        if (event.actionId === 'working-copy:reset') workspace.prepare('reset');
      }
    };
    return {
      workspace,
      publication,
      installation,
      history,
      view,
      handle,
      sourceChanged: () => {
        if (!current() || !view().busy) return false;
        review.set(undefined);
        history.clearAccess();
        workspace.invalidateReadState();
        publication.invalidateReadState();
        installation.invalidateReadState();
        workspace.refresh();
        publication.refresh();
        void installation.refresh();
        return true;
      },
      destroy: () => {
        abort.removeEventListener('abort', destroy);
        destroy();
      },
    };
  }
}

export interface ShippingSourceController extends SourceWorkspaceController {
  readonly workspace: ShippingWorkspaceController;
  readonly publication: ShippingPublicationController;
  readonly installation: ShippingInstallationController;
  readonly history: ShippingHistoryController;
}
