import { TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';

import { ParameterLookupService } from './parameter-lookup.service';
import { AgentService } from '../../services/repo/agent.service';
import { provideMockErrorLogger } from '../../testing/error-logger.spec-helper';

describe('ParameterLookupService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ParameterLookupService,
        provideMockErrorLogger(),
        {
          provide: ModalController,
          useValue: {
            create: vi.fn(() => Promise.resolve({ present: vi.fn() })),
            dismiss: vi.fn(),
          },
        },
        {
          provide: AgentService,
          useValue: { select: vi.fn() },
        },
      ],
    });
  });

  it('should be created', () => {
    expect(TestBed.inject(ParameterLookupService)).toBeTruthy();
  });
});
