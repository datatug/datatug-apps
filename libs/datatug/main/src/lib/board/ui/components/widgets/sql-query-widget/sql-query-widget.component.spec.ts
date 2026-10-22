import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SqlQueryWidgetComponent } from './sql-query-widget.component';
import { BoardCardTabService } from '../../board-card/board-card.component';
import { provideMockErrorLogger } from '../../../../../testing/error-logger.spec-helper';

describe('SqlQueryWidgetComponent', () => {
  let component: SqlQueryWidgetComponent;
  let fixture: ComponentFixture<SqlQueryWidgetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SqlQueryWidgetComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        BoardCardTabService,
        provideMockErrorLogger(),
      ],
    })
      .overrideComponent(SqlQueryWidgetComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SqlQueryWidgetComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
