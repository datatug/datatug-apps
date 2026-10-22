import { inject, type Provider } from '@angular/core';
import { SOURCE_ADAPTER_REGISTRATIONS } from '../source-workspace/source-workspace-contract';
import { ShippingSourceAdapterService } from '../shipping/shipping-source-adapter.service';

/** Deployment composition only. Registrations supply no project/source grants. */
export const SOURCE_ADAPTER_PROVIDERS: Provider[] = [
  {
    provide: SOURCE_ADAPTER_REGISTRATIONS,
    useFactory: () => [inject(ShippingSourceAdapterService).registration],
  },
];
