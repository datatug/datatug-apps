import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IonIcon, IonText } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { alertCircleOutline } from 'ionicons/icons';
import { ExecutionProfile, Limitation } from '../../../contract/types';

addIcons({ alertCircleOutline });

interface LimitationLine {
  readonly text: string;
  readonly kind: 'policy' | 'native-sql';
}

function policyLine(limitation: Limitation): LimitationLine | undefined {
  if (!limitation.policy && !limitation.rowsFiltered && !limitation.hiddenColumns.length) {
    return undefined;
  }
  const parts: string[] = [];
  if (limitation.rowsFiltered) {
    parts.push('rows filtered');
  }
  const hiddenCount = limitation.hiddenColumns.length;
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
 * REQ:limitation-visible — renders the policy limitations a Result carries: policy name,
 * whether rows were filtered, which columns were hidden (an empty list with a generic
 * policy label means a protected name stays hidden — never enumerated), and
 * (REQ:opaque-sql-limitation) the `opaque-privileged` execution-profile note ("row/column
 * enforcement does not apply"), from `Result.provenance.executionProfile`
 * (api-contract.md "Security and errors": "the UI must state row/column enforcement does
 * not apply"). Read-only: it never lets the browser attempt to lift a limitation.
 */
@Component({
  selector: 'sneat-datatug-limitation-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonIcon, IonText],
  templateUrl: './limitation-header.component.html',
  styleUrl: './limitation-header.component.scss',
})
export class LimitationHeaderComponent {
  readonly limitations = input<readonly Limitation[]>([]);
  readonly executionProfile = input<ExecutionProfile | undefined>(undefined);

  protected readonly lines = computed<readonly LimitationLine[]>(() => {
    const lines: LimitationLine[] = this.limitations().flatMap((limitation) => {
      const line = policyLine(limitation);
      return line ? [line] : [];
    });
    if (this.executionProfile() === 'opaque-privileged') {
      lines.push({
        text: 'row/column enforcement does not apply — opaque-privileged execution',
        kind: 'native-sql',
      });
    }
    return lines;
  });
}
