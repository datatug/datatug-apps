import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  IonCard,
  IonCardContent,
  IonIcon,
  IonItem,
  IonLabel,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { playCircle } from 'ionicons/icons';
import type { ProductProfile } from '@datatug/product-profiles';

// kebab-case keys: the template binds kebab-case names (see AppVersionComponent for why camelCase never resolves)
addIcons({ 'play-circle': playCircle });

export type IntroVideo = NonNullable<ProductProfile['homeIntroVideo']>;

/** YouTube video IDs are 11 characters from this alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Click-to-play introduction video for the home page. Until the visitor presses
 * play it shows only a local poster, so the page makes no request to YouTube
 * and sets no third-party cookies. The player then loads from the
 * privacy-enhanced youtube-nocookie.com domain.
 */
@Component({
  selector: 'sneat-datatug-intro-video',
  templateUrl: './intro-video.component.html',
  styleUrl: './intro-video.component.scss',
  imports: [IonCard, IonCardContent, IonIcon, IonItem, IonLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntroVideoComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly video = input.required<IntroVideo>();

  protected readonly playing = signal(false);

  protected readonly validId = computed(() =>
    YOUTUBE_ID.test(this.video().youtubeId),
  );

  // Safe to trust: the URL is a fixed origin plus an ID that passed YOUTUBE_ID.
  protected readonly playerUrl = computed<SafeResourceUrl | undefined>(() =>
    this.validId()
      ? this.sanitizer.bypassSecurityTrustResourceUrl(
          `https://www.youtube-nocookie.com/embed/${this.video().youtubeId}?autoplay=1&rel=0`,
        )
      : undefined,
  );

  protected play(): void {
    this.playing.set(true);
  }
}
