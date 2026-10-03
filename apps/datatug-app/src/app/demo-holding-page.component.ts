import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import {
  captureDemoHandoff,
  demoHandoff,
  isTrustedHandoff,
  isHandoffPath,
  liveHandoffSearch,
} from './demo-handoff-capture';
import {
  DEMO_HOLDING_STRINGS,
  DEMO_PROJECT_PATH,
  DemoHoldingStrings,
  siteUrlFor,
} from './demo-holding-page.strings';
import type { DemoLang } from './demo-handoff-capture';

/** What the page shows for the address it is on; read again when a hand-off arrives while the page is open. */
interface HoldingView {
  readonly trusted: boolean;
  readonly lang: DemoLang;
  readonly strings: DemoHoldingStrings;
  readonly question: string;
  readonly truncated: boolean;
}

/**
 * Takes the hand-off of the current address (index.html's first script has already taken the question out of the
 * address bar and stashed it; otherwise the live address is read and cleaned) and works out what to show.
 * `/demo` and the demo project's own start-chat address say that the live demo opens here soon and show the
 * question back. Any other repository's address (see isTrustedHandoff) gets neutral wording: it must not claim to
 * be a demo, and it carries no question (the capture dropped it).
 */
function readView(): HoldingView {
  captureDemoHandoff();
  const handoff = demoHandoff();
  const lang = handoff?.lang ?? 'en';
  return {
    trusted: isTrustedHandoff(window.location.pathname),
    lang,
    strings: DEMO_HOLDING_STRINGS[lang],
    question: handoff?.question ?? '',
    truncated: handoff?.truncated ?? false,
  };
}

/**
 * Where a hand-off from the sites lands until the live demo can answer it: `/demo` and the project's confirmation
 * page, `/project/github.com/<owner>/<repo>/start-chat#msg=…` (founder ruling 2026-10-03; the old `…/chat?msg=…`
 * is moved there by the route table). It shows the visitor's question back as plain text, says plainly that the
 * demo is not open yet, and links to the demo project and back to the site. It opens no database and reads no
 * project. A start-chat address with no question (nothing to confirm) shows the same page without one.
 *
 * TODO(G-A4b): this is the confirmation page of the design (demo-as-github-project.md 3.1, 6.5). While the demo is
 * off, a "Start" button would have nothing to run, so there is none. When the chat can run a question, "Start"
 * goes in the template next to the question (trusted project and a question only: it runs `question`, in `lang`,
 * and nothing runs before the click), gated by the demo flag read where the flag is read (demo-flag.ts), not here:
 * demo-flag.spec.ts forbids this file to import it.
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
      @let v = view();
      <div class="holding" [attr.lang]="v.lang">
        <h1 #heading tabindex="-1" aria-describedby="demo-holding-message">
          {{ v.trusted ? v.strings.heading : v.strings.neutralHeading }}
        </h1>
        <div id="demo-holding-message" role="status">
          @if (!v.trusted) {
            <p>{{ v.strings.neutralMessage }}</p>
          } @else {
            <p>
              {{
                v.question
                  ? v.strings.withQuestion
                  : v.strings.withoutQuestion
              }}
            </p>
          }
          @if (v.question) {
            <blockquote
              class="ph-no-capture"
              dir="auto"
              [attr.aria-label]="v.strings.questionLabel"
              [textContent]="v.question"
            ></blockquote>
            @if (v.truncated) {
              <p class="note">{{ v.strings.shortened }}</p>
            }
          }
        </div>
        <p class="links">
          @if (v.trusted) {
            <a [routerLink]="demoProjectPath">{{
              v.strings.openDemoProject
            }}</a>
          }
          <a [href]="siteUrl">{{ v.strings.backToSite }}</a>
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
  protected readonly view = signal(readView());
  protected readonly demoProjectPath = DEMO_PROJECT_PATH;
  protected readonly siteUrl = siteUrlFor(document.referrer);
  private readonly heading =
    viewChild.required<ElementRef<HTMLElement>>('heading');

  constructor() {
    this.showInPageLanguage();
    afterNextRender(() => this.heading().nativeElement.focus());
  }

  /**
   * The tab title and the document language follow the page's language while it is shown (a screen reader reads
   * the Russian page with a Russian voice; the tab says what the page is) and are put back when the visitor
   * goes elsewhere: the app's other pages set neither.
   *
   * "Goes elsewhere" is a router navigation to an address that is not a hand-off address, not the component's
   * destruction: the Ionic outlet keeps a page in its stack on a forward navigation (so that Back can return to
   * it), and a kept page is never destroyed. Coming back to a hand-off address re-applies them. The destroy
   * restore is the backstop for a page that is removed without a navigation.
   */
  private showInPageLanguage(): void {
    const doc = inject(DOCUMENT);
    const root = doc.documentElement;
    let saved: { title: string; lang: string | null } | undefined;
    const apply = (): void => {
      saved ??= { title: doc.title, lang: root.getAttribute('lang') };
      const { trusted, strings, lang } = this.view();
      doc.title = trusted ? strings.heading : strings.neutralHeading;
      root.setAttribute('lang', lang);
    };
    const restore = (): void => {
      if (!saved) return;
      doc.title = saved.title;
      if (saved.lang === null) root.removeAttribute('lang');
      else root.setAttribute('lang', saved.lang);
      saved = undefined;
    };
    apply();
    const navigations = inject(Router).events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      if (!isHandoffPath(event.urlAfterRedirects.split(/[?#]/)[0])) return restore();
      // A hand-off that arrives while the page is open (a link pasted into a tab that is already here changes only
      // the fragment: no reload, so index.html's script did not run): take it, and take it out of the address.
      if (liveHandoffSearch()) this.view.set(readView());
      apply();
    });
    inject(DestroyRef).onDestroy(() => {
      navigations.unsubscribe();
      restore();
    });
  }
}
