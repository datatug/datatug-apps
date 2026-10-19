import { NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectCopyOfferComponent } from './project-copy-offer.component';
import { LocalDemoDbService } from '../../demo-sqlite/local-demodb.service';
import { demoSqliteCatalog } from '../../queries/demo-sqlite-catalog';
import { NewProjectService } from './new-project.service';
import { resolveDemoProjectCopySource } from './github-project-copy-source';
vi.mock('./github-project-copy-source', async (importOriginal) => ({ ...await importOriginal<typeof import('./github-project-copy-source')>(), resolveDemoProjectCopySource: vi.fn() }));
const source = { kind: 'github-project' as const, repositoryID: 42, owner: 'datatug', name: 'demo', folder: 'demo-project-1', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
async function setup(dataset = 'demo') {
  const navigate = vi.fn();
  const navigation = new Subject<NavigationStart>();
  const runtimeSession = { entry: demoSqliteCatalog.chinook, state: () => ({ kind: 'ready' }), export: vi.fn(async () => new Uint8Array([83, 81, 76])) };
  await TestBed.configureTestingModule({ imports: [ProjectCopyOfferComponent], providers: [{ provide: Router, useValue: { events: navigation } }, { provide: LocalDemoDbService, useValue: { peek: () => runtimeSession } }] })
    .overrideComponent(ProjectCopyOfferComponent, { set: { providers: [{ provide: NewProjectService, useValue: { navigateToNewProjectPage: navigate } }] } }).compileComponents();
  const fixture = TestBed.createComponent(ProjectCopyOfferComponent);
  fixture.componentRef.setInput('dataset', dataset);
  fixture.detectChanges();
  return { fixture, navigation, runtimeSession, component: fixture.componentInstance, navigate };
}
beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('project copy offer', () => {
  it('shows lookup failure and lets the user retry the selected source', async () => {
    const h = await setup();
    vi.mocked(resolveDemoProjectCopySource).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(source);
    await h.component.copyToGithub();
    await h.fixture.whenStable();
    expect(h.fixture.nativeElement.textContent).toContain('could not be verified');
    expect(h.navigate).not.toHaveBeenCalled();
    await h.component.copyToGithub();
    expect(h.navigate).toHaveBeenCalledWith('github', undefined, undefined, source, expect.any(String));
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

  it('remembers dismissal across component recreation and scopes it to the dataset', async () => {
    const h = await setup('northwind');
    h.component.dismiss();
    h.fixture.destroy();
    const recreated = TestBed.createComponent(ProjectCopyOfferComponent);
    recreated.componentRef.setInput('dataset', 'northwind');
    recreated.detectChanges();
    expect(recreated.componentInstance.expanded()).toBe(false);
    recreated.componentRef.setInput('dataset', 'chinook');
    recreated.detectChanges();
    expect(recreated.componentInstance.expanded()).toBe(true);
    recreated.componentRef.setInput('dataset', 'northwind');
    recreated.detectChanges();
    expect(recreated.componentInstance.expanded()).toBe(false);
    recreated.componentInstance.reopen();
    await recreated.whenStable();
    expect(recreated.nativeElement.querySelector('[data-testid=project-copy-github]')).not.toBeNull();
    expect(recreated.nativeElement.querySelector('[data-testid=project-copy-local]')).not.toBeNull();
  });

  it.each(['dismiss', 'navigation', 'dataset'] as const)('ignores late source errors after %s', async (action) => {
    let reject: ((error: Error) => void) | undefined;
    vi.mocked(resolveDemoProjectCopySource).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const h = await setup('late-error');
    const pending = h.component.copyToGithub();
    if (action === 'dismiss') { h.component.dismiss(); h.component.reopen(); }
    else if (action === 'navigation') h.navigation.next(new NavigationStart(2, '/demo/sqlite'));
    else { h.fixture.componentRef.setInput('dataset', 'another-dataset'); h.fixture.detectChanges(); }
    reject?.(new Error('offline'));
    await pending;
    expect(h.component.error()).toBeUndefined();
    expect(h.component.resolving()).toBe(false);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('downloads the active edited bytes with a safe filename and releases the URL', async () => {
    const h = await setup('chinook');
    h.runtimeSession.export.mockResolvedValueOnce(new Uint8Array([99, 83, 81, 76, 88]).subarray(1, 4));
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:edited');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let filename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { filename = this.download; });
    await h.component.download();
    expect(h.runtimeSession.export).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.size).toBe(3);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([83, 81, 76]));
    expect(filename).toBe('chinook-edited.sqlite');
    expect(h.component.downloadMessage()).toContain('Your edits remain');
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).toHaveBeenCalledWith('blob:edited');
  });

  it('prevents concurrent exports and drops a late export after dismissal', async () => {
    const h = await setup('chinook');
    let finish: ((bytes: Uint8Array<ArrayBuffer>) => void) | undefined;
    h.runtimeSession.export.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const create = vi.spyOn(URL, 'createObjectURL');
    const pending = h.component.download();
    expect(h.component.exporting()).toBe(true);
    await h.component.download();
    expect(h.runtimeSession.export).toHaveBeenCalledOnce();
    h.component.dismiss();
    finish?.(new Uint8Array([83]));
    await pending;
    expect(create).not.toHaveBeenCalled();
    expect(h.component.downloadMessage()).toBeUndefined();
    expect(h.component.exporting()).toBe(false);
  });

  it('shows an actionable provider export error and allows retry', async () => {
    const h = await setup('chinook');
    h.runtimeSession.export.mockRejectedValueOnce({ code: 'sqlite_export_busy' });
    await h.component.download();
    expect(h.component.downloadError()).toContain('Finish the current edit or query');
    expect(h.component.exporting()).toBe(false);
  });

  it('copies verified commands with accessible success or fallback feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const h = await setup();
    h.component.local.set(true);
    h.component.filePath.set('/tmp/edited.sqlite');
    await h.component.copyCommands();
    await h.fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith(h.component.commands());
    expect(h.fixture.nativeElement.querySelector('[role=status]').textContent).toBe('Commands copied.');
    writeText.mockRejectedValueOnce(new Error('denied'));
    await h.component.copyCommands();
    expect(h.component.clipboardMessage()).toContain('Select the commands above');
  });
});
