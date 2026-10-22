import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { JsonTableComponent } from './json-table.component';

describe('JsonTableComponent', () => {
  let component: JsonTableComponent;
  let fixture: ComponentFixture<JsonTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JsonTableComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(JsonTableComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(JsonTableComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('treats booleans as simple values so true and false render', () => {
    expect(component.isSimpleType(true)).toBe(true);
    expect(component.isSimpleType(false)).toBe(true);
    expect(component.isSimpleType({})).toBe(false);
  });
});
