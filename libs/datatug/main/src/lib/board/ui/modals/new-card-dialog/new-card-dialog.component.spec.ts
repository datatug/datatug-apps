import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';

import { NewCardDialogComponent } from './new-card-dialog.component';
import { provideMockErrorLogger } from '../../../../testing/error-logger.spec-helper';

describe('NewCardDialogComponent', () => {
  let component: NewCardDialogComponent;
  let fixture: ComponentFixture<NewCardDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewCardDialogComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        {
          provide: ModalController,
          useValue: {
            create: vi.fn(),
            dismiss: vi.fn(() => Promise.resolve()),
          },
        },
      ],
    })
      .overrideComponent(NewCardDialogComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(NewCardDialogComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
