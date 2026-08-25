import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SqlEditorComponent } from './sql-editor.component';

describe('SqlComponent', () => {
  let component: SqlEditorComponent;
  let fixture: ComponentFixture<SqlEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SqlEditorComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(SqlEditorComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SqlEditorComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('emits the edited SQL without mutating its input signal', () => {
    const listener = vi.fn();
    component.sqlChanged.subscribe(listener);
    fixture.componentRef.setInput('sql', 'select 1');

    component.onSqlChanged('select 2');

    expect(listener).toHaveBeenCalledWith('select 2');
    expect(component.sql()).toBe('select 1');
  });
});
