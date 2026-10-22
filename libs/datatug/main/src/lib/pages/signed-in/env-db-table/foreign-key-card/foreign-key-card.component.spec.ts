import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ForeignKeyCardComponent } from './foreign-key-card.component';
import { ProjectService } from '../../../../services/project/project.service';
import { DatatugNavService } from '../../../../services/nav/datatug-nav.service';
import { AgentService } from '../../../../services/repo/agent.service';
import { provideMockErrorLogger } from '../../../../testing/error-logger.spec-helper';

describe('ForeignKeyCardComponent', () => {
  let component: ForeignKeyCardComponent;
  let fixture: ComponentFixture<ForeignKeyCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ForeignKeyCardComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        { provide: ProjectService, useValue: { getFull: vi.fn() } },
        { provide: DatatugNavService, useValue: { goTable: vi.fn() } },
        { provide: AgentService, useValue: { select: vi.fn() } },
      ],
    })
      .overrideComponent(ForeignKeyCardComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ForeignKeyCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
