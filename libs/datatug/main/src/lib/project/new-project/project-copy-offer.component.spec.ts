import { NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectCopyOfferComponent } from './project-copy-offer.component';
import { NewProjectService } from './new-project.service';
import { resolveDemoProjectCopySource } from './github-project-copy-source';
vi.mock('./github-project-copy-source', () => ({ resolveDemoProjectCopySource: vi.fn() }));
const source = { kind: 'github-project' as const, repositoryID: 42, owner: 'datatug', name: 'demo', folder: 'demo-project-1', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
async function setup() {
  const navigate = vi.fn();
  const navigation = new Subject<NavigationStart>();
  await TestBed.configureTestingModule({ imports: [ProjectCopyOfferComponent], providers: [{ provide: Router, useValue: { events: navigation } }] })
    .overrideComponent(ProjectCopyOfferComponent, { set: { providers: [{ provide: NewProjectService, useValue: { navigateToNewProjectPage: navigate } }] } }).compileComponents();
  const fixture = TestBed.createComponent(ProjectCopyOfferComponent);
  fixture.detectChanges();
  return { fixture, navigation, component: fixture.componentInstance, navigate };
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('project copy offer', () => {
  it('shows lookup failure and lets the user retry the selected source', async () => {
    const h = await setup();
    vi.mocked(resolveDemoProjectCopySource).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(source);
    await h.component.copyToGithub();
    await h.fixture.whenStable();
    expect(h.fixture.nativeElement.textContent).toContain('could not be verified');
    expect(h.navigate).not.toHaveBeenCalled();
    await h.component.copyToGithub();
    expect(h.navigate).toHaveBeenCalledWith('github', undefined, undefined, source);
  });
  it('does not navigate away if the user dismisses while the source is resolving', async () => {
    let resolve: ((value: typeof source) => void) | undefined;
    vi.mocked(resolveDemoProjectCopySource).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const h = await setup();
    const pending = h.component.copyToGithub();
    h.component.dismiss();
    resolve?.(source);
    await pending;
    expect(h.navigate).not.toHaveBeenCalled();
  });
  it('does not redirect after the offer is destroyed during source lookup', async () => {
    let resolve: ((value: typeof source) => void) | undefined;
    vi.mocked(resolveDemoProjectCopySource).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const h = await setup();
    const pending = h.component.copyToGithub();
    h.fixture.destroy();
    resolve?.(source);
    await pending;
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('does not redirect after navigation away when Ionic retains the page', async () => {
    let resolve: ((value: typeof source) => void) | undefined;
    vi.mocked(resolveDemoProjectCopySource).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const h = await setup();
    const pending = h.component.copyToGithub();
    h.navigation.next(new NavigationStart(2, '/demo/sqlite'));
    resolve?.(source);
    await pending;
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('copies verified commands with accessible success or fallback feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const h = await setup();
    h.component.local.set(true);
    await h.component.copyCommands();
    await h.fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith(h.component.commands);
    expect(h.fixture.nativeElement.querySelector('[role=status]').textContent).toBe('Commands copied.');
    writeText.mockRejectedValueOnce(new Error('denied'));
    await h.component.copyCommands();
    expect(h.component.clipboardMessage()).toContain('Select the commands above');
  });
});
