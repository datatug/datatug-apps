import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IonCard, IonCardContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  browsersOutline,
  chatbubblesOutline,
  sparklesOutline,
  terminalOutline,
} from 'ionicons/icons';
import {
  PLATFORM_LEDE,
  PLATFORM_PARTS,
  PLATFORM_STATUS_LABEL,
  PLATFORM_TITLE,
} from './platform-parts';

// kebab-case keys: the template binds kebab-case names (see AppVersionComponent for why camelCase never resolves)
addIcons({
  'browsers-outline': browsersOutline,
  'chatbubbles-outline': chatbubblesOutline,
  'sparkles-outline': sparklesOutline,
  'terminal-outline': terminalOutline,
});

/**
 * "One platform, four ways in.": the DataTug profile's home page tells a visitor what DataTug consists of, one
 * compact card per part with its honest status. Static content (platform-parts.ts), so no state.
 */
@Component({
  selector: 'sneat-datatug-platform-block',
  templateUrl: './platform-block.component.html',
  styleUrl: './platform-block.component.scss',
  imports: [IonCard, IonCardContent, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformBlockComponent {
  protected readonly title = PLATFORM_TITLE;
  protected readonly lede = PLATFORM_LEDE;
  protected readonly parts = PLATFORM_PARTS;
  protected readonly statusLabel = PLATFORM_STATUS_LABEL;
}
