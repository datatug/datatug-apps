import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';

import { JoinsComponent } from './joins.component';
import { ICanJoin, QueryContextSqlService } from '../../../query-context-sql.service';
import { IAstJoin, SqlParser } from '../../../../services/unsorted/sql-parser';
import { provideMockErrorLogger } from '../../../../testing/error-logger.spec-helper';

describe('JoinsComponent', () => {
  let component: JoinsComponent;
  let fixture: ComponentFixture<JoinsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JoinsComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        {
          provide: QueryContextSqlService,
          useValue: {
            suggestedJoins: of(undefined),
            setSql: vi.fn(),
            setTarget: vi.fn(),
          },
        },
      ],
    })
      .overrideComponent(JoinsComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(JoinsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it.each([
    [false, 'INNER JOIN B b ON b.ID = a.ID\n', '-- INNER JOIN B b ON b.ID = a.ID\n', true],
    [true, '-- INNER JOIN B b ON b.ID = a.ID\n', 'INNER JOIN B b ON b.ID = a.ID\n', false],
  ])('checked=%s toggles the join, then parses and emits the toggled SQL', (checked, before, after, disabled) => {
    const parser = new SqlParser();
    const sql = `SELECT *\nFROM dbo.A a\n${before}`;
    fixture.componentRef.setInput('sqlParser', parser);
    component.sql.set(sql);
    const emitted = vi.fn();
    component.astChanged.subscribe(emitted);
    const join = parser.parseQuery(sql).joins?.[0] as IAstJoin;

    component.joinCheckChanged(new CustomEvent('ionChange', { detail: { checked } }), join);

    const toggled = `SELECT *\nFROM dbo.A a\n${after}`;
    expect(component.sql()).toBe(toggled);
    expect(component.queryAst()?.joins?.[0].disabled).toBe(disabled);
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ sql: toggled }));
  });
});

describe('JoinsComponent suggested joins (zoneless)', () => {
  it('renders suggestions that arrive after the first render', async () => {
    const suggested$ = new Subject<ICanJoin[] | undefined>();
    await TestBed.configureTestingModule({
      imports: [JoinsComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        { provide: QueryContextSqlService, useValue: { suggestedJoins: suggested$ } },
      ],
    })
      .overrideComponent(JoinsComponent, {
        set: {
          imports: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          template: '@for (sj of suggestedJoins(); track $index) { <i class="sj">{{ sj.to?.recordset?.name }}</i> }',
        },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(JoinsComponent);
    fixture.detectChanges();
    suggested$.next([{ to: { recordset: { name: 'Customers' } } } as unknown as ICanJoin]);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.sj')).toHaveLength(1);
  });
});
