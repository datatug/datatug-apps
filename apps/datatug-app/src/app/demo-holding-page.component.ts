import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  captureDemoHandoff,
  demoHandoff,
  isEchoTrusted,
} from './demo-handoff-capture';
import {
  DEMO_HOLDING_STRINGS,
  DEMO_PROJECT_PATH,
  siteUrlFor,
} from './demo-holding-page.strings';

/**
 * Where a hand-off from the sites lands until the live demo can answer it: `/demo` and
 * `/project/github.com/<owner>/<repo>/chat`. It shows the visitor's question back as plain text, says plainly
 * that the demo is not open yet, and links to the demo project and back to the site. It opens no database and
 * reads no project.
 *
 * The `ion-header`, `ion-toolbar`, `ion-title` and `ion-content` elements are the app shell's own (datatug-app
 * .component.html imports and so registers all four before any route renders). They are used here as plain
 * elements, without importing their Angular wrappers a second time: importing them made the bundler split a
 * shared chunk in two and grow the initial download by about 2 kB for no behaviour this page uses.
 */
@Component({
  selector: 'sneat-datatug-demo-holding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>DataTug</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="holding" [attr.lang]="lang">
        <h1 #heading tabindex="-1" aria-describedby="demo-holding-message">
          {{ trusted ? strings.heading : strings.neutralHeading }}
        </h1>
        <div id="demo-holding-message" role="status">
          @if (!trusted) {
            <p>{{ strings.neutralMessage }}</p>
          } @else {
            <p>
              {{ question ? strings.withQuestion : strings.withoutQuestion }}
            </p>
          }
          @if (question) {
            <blockquote
              class="ph-no-capture"
              [attr.aria-label]="strings.questionLabel"
              [textContent]="question"
            ></blockquote>
            @if (truncated) {
              <p class="note">{{ strings.shortened }}</p>
            }
          }
        </div>
        <p class="links">
          @if (trusted) {
            <a [routerLink]="demoProjectPath">{{ strings.openDemoProject }}</a>
          }
          <a [href]="siteUrl">{{ strings.backToSite }}</a>
        </p>
      </div>
    </ion-content>
  `,
  styles: `
    .holding {
      max-width: 40rem;
      margin: 0 auto;
    }
    h1 {
      margin: 0.5rem 0 1rem;
      font-size: 1.5rem;
      outline: none;
    }
    blockquote {
      margin: 1rem 0;
      padding: 0.5rem 1rem;
      border-left: 4px solid var(--ion-color-primary);
      /* pre-wrap shows every character of the question, so no whitespace may be added inside the element. */
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .note {
      color: var(--ion-color-medium);
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1.5rem;
      margin-top: 1.5rem;
    }
  `,
})
export class DemoHoldingPageComponent {
  // index.html's first script has already taken the query out of the address bar and stashed it; this parses it.
  private readonly handoff = (captureDemoHandoff(), demoHandoff());
  // `/demo` and the demo project's own chat address say that the live demo opens here soon and show the question
  // back. Any other repository's chat address (see isEchoTrusted) gets neutral wording: it must not claim to be
  // a demo, and it carries no question (the capture dropped it).
  protected readonly trusted = isEchoTrusted(window.location.pathname);
  protected readonly lang = this.handoff?.lang ?? 'en';
  protected readonly strings = DEMO_HOLDING_STRINGS[this.lang];
  protected readonly question = this.handoff?.question ?? '';
  protected readonly truncated = this.handoff?.truncated ?? false;
  protected readonly demoProjectPath = DEMO_PROJECT_PATH;
  protected readonly siteUrl = siteUrlFor(document.referrer);
  private readonly heading =
    viewChild.required<ElementRef<HTMLElement>>('heading');

  constructor() {
    afterNextRender(() => this.heading().nativeElement.focus());
  }
}
