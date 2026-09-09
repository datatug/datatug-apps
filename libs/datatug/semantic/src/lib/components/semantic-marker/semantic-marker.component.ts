import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { helpCircleOutline, pricetag } from 'ionicons/icons';
import { SemanticProvenance } from '../../../contract/types';

addIcons({ pricetag, helpCircleOutline });

/**
 * REQ:semantic-markers-in-grid — the small marker a grid column header shows for a
 * column mapped to a semantic field, with tooltip `entity.field · provenance`
 * (AC:mapped-columns-marked, AC:inferred-mapping-labelled). Purely presentational: it
 * never alters values or column order, and the provenance it renders must come from
 * `GET /datatug/semantic/columns` (via {@link SemanticApiService}), never computed here.
 */
@Component({
  selector: 'sneat-datatug-semantic-marker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonIcon],
  templateUrl: './semantic-marker.component.html',
  styleUrl: './semantic-marker.component.scss',
})
export class SemanticMarkerComponent {
  readonly entity = input.required<string>();
  readonly field = input.required<string>();
  readonly provenance = input.required<SemanticProvenance>();

  protected readonly icon = computed(() =>
    this.provenance() === 'declared' ? 'pricetag' : 'helpCircleOutline',
  );

  protected readonly tooltip = computed(
    () => `${this.entity()}.${this.field()} · ${this.provenance()}`,
  );
}
