import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { IonCol, IonRow } from '@ionic/angular';

import { BoardRowComponent } from './board-row.component';

describe('BoardRowComponent', () => {
  let fixture: ComponentFixture<BoardRowComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardRowComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(BoardRowComponent, {
        set: { imports: [IonCol, IonRow], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardRowComponent);
  });

  it('renders full-width mobile cards and valid model spans on wider screens', () => {
    fixture.componentRef.setInput('boardRowDef', {
      cards: [
        { id: 'full', title: 'Full', cols: 12 },
        { id: 'wide', title: 'Wide', cols: 8 },
        { id: 'invalid', title: 'Invalid', cols: 0 },
        { id: 'missing', title: 'Missing' },
      ],
    });
    fixture.detectChanges();

    const columns = fixture.debugElement.queryAll(By.directive(IonCol));
    expect(columns).toHaveLength(4);
    expect(columns.map((column) => column.componentInstance.size)).toEqual([
      '12',
      '12',
      '12',
      '12',
    ]);
    expect(columns.map((column) => column.componentInstance.sizeMd)).toEqual([
      '12',
      '8',
      '6',
      '6',
    ]);
  });

  it('rejects fractional and out-of-range spans', () => {
    fixture.componentRef.setInput('boardRowDef', {
      cards: [
        { id: 'fraction', title: 'Fraction', cols: 2.5 },
        { id: 'large', title: 'Large', cols: 13 },
      ],
    });
    fixture.detectChanges();

    const columns = fixture.debugElement.queryAll(By.directive(IonCol));
    expect(columns.map((column) => column.componentInstance.sizeMd)).toEqual([
      '6',
      '6',
    ]);
  });
});
