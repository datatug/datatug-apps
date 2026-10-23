import { TestBed } from '@angular/core/testing';
import { WorkFormComponent } from './work-form.component';
import { workDetailFixture } from './work.spec-helper';
describe('WorkFormComponent', () => {
  it('creates a typed draft with owner separate from primary assignee', async () => {
    const fixture = TestBed.createComponent(WorkFormComponent);
    fixture.componentRef.setInput('actor', 'lead');
    fixture.componentRef.setInput('members', workDetailFixture().members);
    fixture.componentRef.setInput(
      'environments',
      workDetailFixture().environments,
    );
    fixture.detectChanges();
    await fixture.whenStable();
    const form = fixture.componentInstance;
    form.form.patchValue({
      type: 'case',
      title: 'Investigate missing shipment',
      assigneeIds: ['developer'],
      primaryAssigneeId: 'developer',
    });
    const received = vi.fn();
    form.submitted.subscribe(received);
    form.submit();
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          type: 'case',
          ownerId: 'lead',
          assigneeIds: ['developer'],
          primaryAssigneeId: 'developer',
        }),
        contextScope: { environmentId: 'demo', identityDomain: 'northwind' },
      }),
    );
  });
  it('keeps identity domains distinct within the same environment and inherits the exact parent scope', async () => {
    const fixture = TestBed.createComponent(WorkFormComponent);
    const first = workDetailFixture().environments[0];
    fixture.componentRef.setInput('environments', [
      first,
      { ...first, identityDomain: 'shipping', title: 'Shipping' },
    ]);
    fixture.componentRef.setInput('initialScope', {
      environmentId: first.environmentId,
      identityDomain: 'shipping',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance,
      received = vi.fn();
    c.submitted.subscribe(received);
    c.form.controls.title.setValue('Shipment');
    c.submit();
    expect(received).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contextScope: {
          environmentId: first.environmentId,
          identityDomain: 'shipping',
        },
      }),
    );
    c.form.controls.environment.setValue(c.scopeKey(first));
    c.submit();
    expect(received).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contextScope: {
          environmentId: first.environmentId,
          identityDomain: first.identityDomain,
        },
      }),
    );
  });
  it('does not submit empty titles or a primary assignee outside the assigned set', () => {
    const fixture = TestBed.createComponent(WorkFormComponent);
    fixture.componentRef.setInput(
      'environments',
      workDetailFixture().environments,
    );
    fixture.detectChanges();
    const c = fixture.componentInstance;
    const received = vi.fn();
    c.submitted.subscribe(received);
    c.form.patchValue({ title: '   ' });
    c.submit();
    expect(received).not.toHaveBeenCalled();
    c.form.patchValue({
      title: 'Task',
      assigneeIds: ['developer'],
      primaryAssigneeId: 'outsider',
    });
    c.submit();
    expect(received).not.toHaveBeenCalled();
  });
  it('updates member labels when data arrives after first render', async () => {
    const fixture = TestBed.createComponent(WorkFormComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('members', workDetailFixture().members);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Team Lead');
  });
});
