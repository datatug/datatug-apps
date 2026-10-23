import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PopoverController } from '@ionic/angular';

import { EntityFieldDialogComponent } from './entity-field-dialog.component';
import { provideMockErrorLogger } from '../../../../testing/error-logger.spec-helper';

describe('EntityFieldDialogComponent', () => {
  let component: EntityFieldDialogComponent;
  let fixture: ComponentFixture<EntityFieldDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityFieldDialogComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: PopoverController,
          useValue: {
            create: vi.fn(),
            dismiss: vi.fn(() => Promise.resolve()),
          },
        },
        provideMockErrorLogger(),
      ],
    })
      .overrideComponent(EntityFieldDialogComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EntityFieldDialogComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
