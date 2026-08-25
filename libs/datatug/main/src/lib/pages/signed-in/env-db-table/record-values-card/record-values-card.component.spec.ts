import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RecordValuesCardComponent } from './record-values-card.component';

describe('RecordValuesCardComponent', () => {
  let component: RecordValuesCardComponent;
  let fixture: ComponentFixture<RecordValuesCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecordValuesCardComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(RecordValuesCardComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(RecordValuesCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
