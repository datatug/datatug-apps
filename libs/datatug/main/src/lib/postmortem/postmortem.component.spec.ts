import { TestBed } from '@angular/core/testing';
import { PostmortemComponent } from './postmortem.component';
import { PostmortemApiService } from './postmortem-api.service';
import { emptyReport, type PostmortemDetail } from './postmortem.models';
import { workDetailFixture } from '../work/work.spec-helper';
function fixture(): PostmortemDetail {
  const work = workDetailFixture();
  return {
    work: { ...work, item: { ...work.item, type: 'postmortem' } },
    report: {
      workItemId: work.item.id,
      revision: 1,
      digest: 'digest',
      draft: emptyReport(),
      evidence: [],
      authorId: 'alice',
      at: '2026-10-24T00:00:00Z',
      origin: 'manual',
    },
    capabilities: { canApprove: true, canPublish: true, canShare: true },
    publications: [],
    links: [],
  };
}
describe('Postmortem report journey', () => {
  let api: {
    read: ReturnType<typeof vi.fn>;
    action: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
    revisions: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    api = {
      read: vi.fn().mockResolvedValue(fixture()),
      action: vi.fn(),
      generate: vi.fn(),
      revisions: vi.fn().mockResolvedValue([]),
    };
    TestBed.configureTestingModule({
      imports: [PostmortemComponent],
      providers: [{ provide: PostmortemApiService, useValue: api }],
    });
  });
  async function render() {
    const host = TestBed.createComponent(PostmortemComponent);
    host.componentRef.setInput('work', fixture().work);
    await host.whenStable();
    return host;
  }
  it('renders asynchronous report content with zoneless signals', async () => {
    const host = await render();
    expect(host.nativeElement.textContent).toContain('Postmortem report');
    expect(host.nativeElement.textContent).toContain('Root Cause');
  });
  it('keeps manual edits when generation fails and requires explicit save first', async () => {
    const host = await render();
    const component = host.componentInstance;
    component.updateSection(0, 'text', 'Manual explanation');
    await component.generate();
    expect(api.generate).not.toHaveBeenCalled();
    expect(component.draft().sections[0].text).toBe('Manual explanation');
    expect(component.dirty()).toBe(true);
  });
  it('retries the identical operation after an ambiguous action failure', async () => {
    const host = await render();
    api.action
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(fixture());
    await host.componentInstance.command('approve');
    const original = structuredClone(api.action.mock.calls[0][0]);
    await host.componentInstance.retry();
    expect(api.action.mock.calls[1][0]).toEqual(original);
    expect(original).not.toHaveProperty('createdBy');
    expect(host.componentInstance.pending()).toBeUndefined();
  });
  it('retries generation with the same operation identity after transport failure', async () => {
    const host = await render();
    api.generate
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValueOnce({
        candidate: { id: 'candidate', draft: emptyReport() },
      });
    await host.componentInstance.generate();
    const original = structuredClone(api.generate.mock.calls[0][0]);
    await host.componentInstance.generate();
    expect(api.generate.mock.calls[1][0]).toEqual(original);
    expect(host.componentInstance.candidate()?.id).toBe('candidate');
  });
  it('approval never promotes an embedded recommendation', async () => {
    const host = await render();
    api.action.mockResolvedValue(fixture());
    await host.componentInstance.decision(
      {
        id: 'p',
        kind: 'check',
        revision: 1,
        state: 'proposed',
        dto: {},
        evidenceIds: [],
        rationale: '',
      },
      'approved',
    );
    expect(api.action.mock.calls[0][0].action).toBe('proposal-decision');
    expect(api.action.mock.calls[0][0]).not.toHaveProperty('enabled');
  });
  it('public preview removes source identifiers and requires renewed acknowledgement after edits', async () => {
    const host = await render();
    const c = host.componentInstance;
    c.draft.set({
      sections: [
        {
          name: 'root-cause',
          text: 'Unknown',
          classification: 'unknown',
          evidenceIds: ['private-source'],
        },
      ],
      recommendations: [],
    });
    c.preparePublication();
    expect(c.publicSections()[0].evidenceIds).toEqual([]);
    c.publicationAcknowledged.set(true);
    c.updatePublicSection(0, 'Reviewed safe unknown');
    expect(c.publicationAcknowledged()).toBe(false);
    expect(c.draft().sections[0].text).toBe('Unknown');
  });
  it('keeps a freshly issued share token when the same Work identity refreshes', async () => {
    const host = await render();
    host.componentInstance.token.set('secret');
    host.componentRef.setInput('work', {
      ...fixture().work,
      item: { ...fixture().work.item, version: 2 },
    });
    await host.whenStable();
    expect(host.componentInstance.token()).toBe('secret');
  });
});
