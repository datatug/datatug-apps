import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

/** Ionic can enter the next checkout before the previous view leaves. */
@Injectable({ providedIn: 'root' })
export class CheckoutTitle {
  private readonly title = inject(Title);
  private owner?: object;
  claim(owner: object, value: string): void {
    this.owner = owner;
    this.title.setTitle(value);
  }
  release(owner: object, value: string, previous: string): void {
    if (this.owner !== owner) return;
    this.owner = undefined;
    if (this.title.getTitle() === value) this.title.setTitle(previous);
  }
}
