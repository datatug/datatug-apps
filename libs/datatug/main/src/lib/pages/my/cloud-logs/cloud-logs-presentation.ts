import { InjectionToken } from '@angular/core';
import type { PersonalLogQuery } from './cloud-logs-api.service';

/** Fixed equality fields supported by the current Cloud Logs protocol.
 * Presentation metadata does not expand the server's admitted query surface. */
export interface PersonalLogField {
  readonly key: keyof Pick<PersonalLogQuery, 'correlationId' | 'orderId' | 'service'>;
  readonly label: string;
  readonly elementId: string;
  readonly sourceField: string;
}
export const PERSONAL_LOG_FIELDS = new InjectionToken<readonly PersonalLogField[]>(
  'personal log protocol field presentation', {
    providedIn: 'root',
    factory: () => [
      { key: 'correlationId', label: 'Correlation ID', elementId: 'cloud-logs-correlation-id', sourceField: 'correlation_id' },
      { key: 'orderId', label: 'Order ID', elementId: 'cloud-logs-order-id', sourceField: 'order_id' },
      { key: 'service', label: 'Service', elementId: 'cloud-logs-service', sourceField: 'service' },
    ],
  },
);
