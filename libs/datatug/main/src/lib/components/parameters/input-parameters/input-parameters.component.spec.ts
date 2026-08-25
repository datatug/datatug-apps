import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InputParametersComponent } from './input-parameters.component';

describe('InputParametersComponent', () => {
  let component: InputParametersComponent;
  let fixture: ComponentFixture<InputParametersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InputParametersComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(InputParametersComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(InputParametersComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
