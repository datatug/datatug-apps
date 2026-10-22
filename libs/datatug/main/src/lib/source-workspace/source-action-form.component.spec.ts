import { TestBed } from '@angular/core/testing';
import { SourceActionFormComponent } from './source-action-form.component';
import { type SourceInteraction } from './source-workspace-contract';

const review: SourceInteraction = {
  reviewId: 'review-1',
  actionId: 'update',
  title: 'Review update',
  description: 'Review the selected revision.',
  phase: 'review',
  enabled: true,
  submitLabel: 'Confirm update',
  cancelLabel: 'Cancel',
  fields: [
    { id: 'revision', label: 'Revision', type: 'integer', required: true },
  ],
};
describe('neutral source action input', () => {
  async function mount(interaction = review) {
    const f = TestBed.createComponent(SourceActionFormComponent);
    f.componentRef.setInput('interaction', interaction);
    f.detectChanges();
    await f.whenStable();
    return f;
  }
  it('keeps integer strings exact beyond JavaScript precision and has no hidden defaults', async () => {
    const f = await mount(),
      emitted = vi.fn();
    f.componentInstance.submitted.subscribe(emitted);
    f.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await f.whenStable();
    expect(emitted).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('Revision is required');
    f.nativeElement
      .querySelector('ion-input')
      .dispatchEvent(
        new CustomEvent('ionInput', { detail: { value: '9007199254740993' } }),
      );
    f.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    expect(emitted).toHaveBeenCalledExactlyOnceWith({
      revision: { type: 'integer', value: '9007199254740993' },
    });
  });
  it('does not inherit values from object properties for declared input IDs', async () => {
    const f = await mount({
        ...review,
        fields: [
          {
            id: 'constructor',
            label: 'Constructor value',
            type: 'integer',
            required: true,
          },
        ],
      }),
      emitted = vi.fn();
    f.componentInstance.submitted.subscribe(emitted);
    f.componentInstance.submit(new Event('submit'));
    expect(emitted).not.toHaveBeenCalled();
    f.componentInstance.change('constructor', '17');
    f.componentInstance.submit(new Event('submit'));
    expect(emitted).toHaveBeenCalledExactlyOnceWith({
      constructor: { type: 'integer', value: '17' },
    });
  });
  it.each(['01', '+1', '-0', '1e3', '1.0', ' 1', '1 '])(
    'refuses noncanonical integer %s',
    async (value) => {
      const f = await mount(),
        emitted = vi.fn();
      f.componentInstance.submitted.subscribe(emitted);
      f.componentInstance.change('revision', value);
      f.componentInstance.submit(new Event('submit'));
      await f.whenStable();
      expect(emitted).not.toHaveBeenCalled();
      expect(f.nativeElement.textContent).toContain('canonical integer');
    },
  );
  it('requires an actual offered choice, allows cancel, and resets only when the review identity/fields/phase changes', async () => {
    const f = await mount({
        ...review,
        fields: [
          {
            ...review.fields[0],
            choices: [{ label: 'Revision seventeen', value: '17' }],
          },
        ],
      }),
      emitted = vi.fn(),
      cancel = vi.fn();
    f.componentInstance.submitted.subscribe(emitted);
    f.componentInstance.cancelReview.subscribe(cancel);
    f.componentInstance.change('revision', '18');
    f.componentInstance.submit(new Event('submit'));
    expect(emitted).not.toHaveBeenCalled();
    f.componentInstance.change('revision', '17');
    f.componentRef.setInput('interaction', {
      ...f.componentInstance.interaction(),
      description: 'Still reviewing this operation.',
    });
    await f.whenStable();
    expect(f.componentInstance.values()).toEqual({ revision: '17' });
    f.componentInstance.submit(new Event('submit'));
    expect(emitted).toHaveBeenCalledExactlyOnceWith({
      revision: { type: 'integer', value: '17' },
    });
    f.nativeElement.querySelector('header ion-button').click();
    expect(cancel).toHaveBeenCalledOnce();
    f.componentRef.setInput('interaction', { ...review, reviewId: 'review-2' });
    await f.whenStable();
    expect(f.componentInstance.values()).toEqual({});
  });
  it('exposes only supplied uncertain retry and explicit conflict-review controls, with no submit/edit input', async () => {
    const f = await mount({
        ...review,
        phase: 'uncertain',
        retryLabel: 'Retry original update',
      }),
      retry = vi.fn(),
      conflict = vi.fn();
    f.componentInstance.retry.subscribe(retry);
    f.componentInstance.reviewConflict.subscribe(conflict);
    expect(f.nativeElement.querySelector('form')).toBeNull();
    expect(f.nativeElement.textContent).toContain('Retry original update');
    f.nativeElement.querySelector('section > ion-button').click();
    expect(retry).toHaveBeenCalledOnce();
    f.componentRef.setInput('interaction', {
      ...review,
      phase: 'conflict',
      conflictLabel: 'I reviewed current revision',
    });
    await f.whenStable();
    expect(f.nativeElement.textContent).not.toContain('Retry original update');
    f.nativeElement.querySelector('section > ion-button').click();
    expect(conflict).toHaveBeenCalledOnce();
  });
});
