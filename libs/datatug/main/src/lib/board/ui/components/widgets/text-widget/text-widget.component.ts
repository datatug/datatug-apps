import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { TextWidgetDef } from '@datatug/board-models';
import { renderSafeMarkdown, type TextParameterValues } from './safe-markdown';

/** `text` widget: markdown with raw HTML disabled and `{{param}}` placeholders. */
@Component({
  selector: 'sneat-datatug-text-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (def()?.title; as title) {
      <p class="widget-title">{{ title }}</p>
    }
    <div class="text-widget-body" #body></div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 0.5rem 1rem;
      }
      .widget-title {
        margin: 0 0 0.25rem;
        font-weight: 600;
      }
      .text-widget-body {
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class TextWidgetComponent {
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private readonly doc = inject(DOCUMENT);
  readonly def = input<TextWidgetDef>();
  readonly values = input<TextParameterValues>({});

  constructor() {
    effect(() => {
      const body = this.body()?.nativeElement;
      if (!body) return;
      const markdown = this.def()?.markdown;
      body.replaceChildren(
        typeof markdown === 'string'
          ? renderSafeMarkdown(markdown, this.values(), this.doc)
          : '',
      );
    });
  }
}
