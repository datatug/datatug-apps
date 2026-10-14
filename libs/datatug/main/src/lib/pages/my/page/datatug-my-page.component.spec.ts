import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterLink } from '@angular/router';

import { DatatugMyPageComponent } from './datatug-my-page.component';

describe('MyPage', () => {
  let component: DatatugMyPageComponent;
  let fixture: ComponentFixture<DatatugMyPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatatugMyPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [provideRouter([])],
    })
      .overrideComponent(DatatugMyPageComponent, {
        set: {
          imports: [RouterLink],
          template:
            '<a routerLink="/subscriptions" [queryParams]="subscriptionQuery()">Subscriptions</a>',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DatatugMyPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps the subscriptions link on the current rail after account query changes', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?checkout=test');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe(
      '/subscriptions?checkout=test',
    );
    await router.navigateByUrl('/');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe(
      '/subscriptions',
    );
  });
});
