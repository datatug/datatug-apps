import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ProjectCardsService } from '../../../../cards/project-cards.service';

import {
  BoardCardComponent,
  BoardCardTabService,
} from './board-card.component';

const getCard = vi.fn();

describe('BoardCardComponent', () => {
  let component: BoardCardComponent;
  let fixture: ComponentFixture<BoardCardComponent>;

  beforeEach(async () => {
    getCard.mockReset().mockReturnValue(of({ id: 'customer', title: 'Customer', widget: { name: 'text', data: { markdown: '' } } }));
    await TestBed.configureTestingModule({
      imports: [BoardCardComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        BoardCardTabService,
        { provide: ProjectCardsService, useValue: { getCard, invalidate: vi.fn() } },
      ],
    })
      .overrideComponent(BoardCardComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads a referenced card again only when the environment changes, not for every parameter change', async () => {
    const project = { storeId: 's', projectId: 'p' };
    fixture.componentRef.setInput('boarCardDef', { id: 'cell', title: '', ref: { cardId: 'customer' } });
    fixture.componentRef.setInput('projectRef', project);
    fixture.componentRef.setInput('boardContext', { mode: 'view', environment: 'dev', parameters: {} });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getCard).toHaveBeenCalledTimes(1);
    expect(getCard).toHaveBeenCalledWith(project, 'customer', 'dev');
    expect(component.refState().kind).toBe('ready');
    fixture.componentRef.setInput('boardContext', {
      mode: 'view',
      environment: 'dev',
      parameters: { customerId: { type: 'string', value: 'ALFKI' } },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getCard).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('boardContext', { mode: 'view', environment: 'prod', parameters: {} });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getCard).toHaveBeenCalledTimes(2);
    expect(getCard).toHaveBeenLastCalledWith(project, 'customer', 'prod');
  });
});
