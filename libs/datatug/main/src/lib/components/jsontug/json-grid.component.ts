import { JsonPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { IJsonGridData } from '../../plugins/interfaces';

@Component({
  selector: 'sneat-datatug-json-grid',
  templateUrl: 'json-grid.component.html',
  styleUrls: ['json-component.scss'],
  imports: [JsonPipe],
})
export class JsonGridComponent {
  readonly jsonGrid = input<IJsonGridData>();
}
