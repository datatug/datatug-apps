import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WidgetsPageComponent } from './widgets-page.component';

describe('WidgetsPage', () => {
  let component: WidgetsPageComponent;
  let fixture: ComponentFixture<WidgetsPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WidgetsPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(WidgetsPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(WidgetsPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
