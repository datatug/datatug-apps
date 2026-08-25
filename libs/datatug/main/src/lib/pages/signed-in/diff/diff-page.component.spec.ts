import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DiffPageComponent } from './diff-page.component';

describe('DiffPage', () => {
  let component: DiffPageComponent;
  let fixture: ComponentFixture<DiffPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiffPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(DiffPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DiffPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
