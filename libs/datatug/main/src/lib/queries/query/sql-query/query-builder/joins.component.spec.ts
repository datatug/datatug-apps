import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { JoinsComponent } from './joins.component';
import { QueryContextSqlService } from '../../../query-context-sql.service';
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
});
