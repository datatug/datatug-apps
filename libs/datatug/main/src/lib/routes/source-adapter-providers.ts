import { INCIDENT_RECOVERY_ADAPTERS } from '../detective/incident-recovery-adapter';
import { ShippingResolutionAdapterService } from '../shipping/shipping-resolution-adapter.service';
import { SOURCE_EVIDENCE_PRESENTERS } from '../evidence/source-evidence-presentation';
import { shippingEvidencePresenter } from '../shipping/shipping-evidence-presenter';
import {
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { clearPendingEvidenceLinkOnSignOut } from '../evidence/shared-evidence-link.component';
import { SOURCE_ADAPTER_REGISTRATIONS } from '../source-workspace/source-workspace-contract';
import { ShippingSourceAdapterService } from '../shipping/shipping-source-adapter.service';
import { BusinessClockService } from '../source-workspace/business-clock';

/** Deployment composition only. Registrations supply no project/source grants. */
export const SOURCE_ADAPTER_PROVIDERS: (Provider | EnvironmentProviders)[] = [
  {
    provide: INCIDENT_RECOVERY_ADAPTERS,
    useFactory: () => [inject(ShippingResolutionAdapterService).registration],
  },
  {
    provide: SOURCE_EVIDENCE_PRESENTERS,
    useValue: [shippingEvidencePresenter],
  },
  {
    provide: SOURCE_ADAPTER_REGISTRATIONS,
    useFactory: () => [inject(ShippingSourceAdapterService).registration],
  },
  // One shared business-clock read for every page under these routes.
  BusinessClockService,
  // A sign-out on any page forgets a pending evidence link.
  provideEnvironmentInitializer(clearPendingEvidenceLinkOnSignOut),
];
