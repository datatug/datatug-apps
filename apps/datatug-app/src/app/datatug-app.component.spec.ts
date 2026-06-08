import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed, waitForAsync } from '@angular/core/testing';

import { DatatugAppComponent } from './datatug-app.component';

@Component({ selector: 'sneat-datatug-menu', template: '' })
class MenuStubComponent {}

describe('AppComponent', () => {
  beforeEach(waitForAsync(async () => {
    await TestBed.configureTestingModule({
      imports: [DatatugAppComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(DatatugAppComponent, {
        set: { imports: [], template: '', schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
  }));

  it('should create the app', () => {
    const fixture = TestBed.createComponent(DatatugAppComponent);
    const app = fixture.debugElement.componentInstance;
    expect(app).toBeTruthy();
  });
});

describe('AppComponent template', () => {
  beforeEach(waitForAsync(async () => {
    await TestBed.configureTestingModule({
      imports: [DatatugAppComponent],
    })
      .overrideComponent(DatatugAppComponent, {
        set: { imports: [MenuStubComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
  }));

  it('should include the side menu', () => {
    const fixture = TestBed.createComponent(DatatugAppComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sneat-datatug-menu')).toBeTruthy();
  });
});
