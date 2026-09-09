import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IonIcon, IonText } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { alertCircleOutline } from 'ionicons/icons';
import { ResultLimitation } from '../../models/models';

addIcons({ alertCircleOutline });

interface LimitationLine {
  readonly text: string;
  readonly kind: 'policy' | 'native-sql';
}

function policyLine(limitation: ResultLimitation): LimitationLine | undefined {
  if (
    !limitation.policy &&
    !limitation.rowsFiltered &&
    !limitation.hiddenColumns?.length
  ) {
    return undefined;
  }
  const parts: string[] = [];
  if (limitation.rowsFiltered) {
    parts.push('rows filtered');
  }
  const hiddenCount = limitation.hiddenColumns?.length ?? 0;
  if (hiddenCount > 0) {
    parts.push(`${hiddenCount} column${hiddenCount === 1 ? '' : 's'} hidden`);
  }
  const suffix = parts.length ? `: ${parts.join(', ')}` : '';
  const text = limitation.policy
    ? `Limited by policy ${limitation.policy}${suffix}`
    : `Limited${suffix}`;
  return { text, kind: 'policy' };
}

/**
 * REQ:limitation-visible — renders the policy limitations a result carries: policy name,
 * whether rows were filtered, which columns were hidden, and (REQ:opaque-sql-limitation)
 * the native-SQL note. Read-only: it never lets the browser attempt to lift a limitation.
 */
@Component({
  selector: 'sneat-datatug-limitation-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonIcon, IonText],
  templateUrl: './limitation-header.component.html',
  styleUrl: './limitation-header.component.scss',
})
export class LimitationHeaderComponent {
  readonly limitations = input<readonly ResultLimitation[]>([]);

  protected readonly lines = computed<readonly LimitationLine[]>(() =>
    this.limitations().flatMap((limitation) => {
      const lines: LimitationLine[] = [];
      const policy = policyLine(limitation);
      if (policy) {
        lines.push(policy);
      }
      if (limitation.nativeSqlPoliciesNotApplied) {
        lines.push({
          text: 'row/column policies not applied to native SQL',
          kind: 'native-sql',
        });
      }
      return lines;
    }),
  );
}
