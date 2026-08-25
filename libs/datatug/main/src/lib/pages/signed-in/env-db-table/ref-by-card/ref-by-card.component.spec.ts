import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RefByCardComponent } from './ref-by-card.component';

describe('RefByCardComponent', () => {
  let component: RefByCardComponent;
  let fixture: ComponentFixture<RefByCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RefByCardComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(RefByCardComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(RefByCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
