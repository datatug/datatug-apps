import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BoardRowComponent } from './board-row.component';

describe('BoardRowComponent', () => {
  let component: BoardRowComponent;
  let fixture: ComponentFixture<BoardRowComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardRowComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(BoardRowComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardRowComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
