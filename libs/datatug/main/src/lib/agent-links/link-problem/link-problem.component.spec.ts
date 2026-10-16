import { TestBed } from '@angular/core/testing';
import { AgentTableRef, LinkProblem } from '../agent-link-api.service';
import {
  LinkProblemComponent,
  browserMayBlockLoopback,
  linkProblemText,
} from './link-problem.component';

const REF: AgentTableRef = {
  storeId: 'http-127.0.0.1:8989',
  project: 'demo',
  env: 'local',
  source: 'chinook',
  table: { schema: '', name: 'Album' },
};

const STATES: [LinkProblem, string, string][] = [
  ['agent-unreachable', '127.0.0.1:8989 cannot be reached', 'datatug daemon start'],
  ['link-expired', 'expired or was already used', 'fresh link'],
  ['project-not-found', 'no project demo', 'datatug daemon start'],
  ['database-not-found', 'no database chinook in environment local', 'datatug db add'],
  ['table-not-found', 'Database chinook has no table Album', 'renamed or dropped'],
  ['record-not-found', 'Album has no record with the key in this link', 'deleted'],
  ['bad-key', 'not a primary key of Album', 'fresh link'],
  ['read-failed', 'could not read this view', 'Check again'],
];

describe('LinkProblemComponent (AC:unresolvable-link-names-the-problem)', () => {
  it.each(STATES)('%s: says what is wrong, on the same page, with a hint and Check again', async (problem, title, hint) => {
    TestBed.configureTestingModule({ imports: [LinkProblemComponent] });
    const fixture = TestBed.createComponent(LinkProblemComponent);
    fixture.componentRef.setInput('problem', problem);
    fixture.componentRef.setInput('tableRef', REF);
    let checks = 0;
    fixture.componentInstance.checkAgain.subscribe(() => checks++);
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const card = el.querySelector('[data-testid="link-problem"]');
    expect(card?.getAttribute('data-problem')).toBe(problem);
    expect(el.textContent).toContain(title);
    expect(el.textContent).toContain(hint);
    expect(el.textContent).toContain(problem);
    (el.querySelector('[data-testid="link-check-again"]') as HTMLElement).click();
    expect(checks).toBe(1);
  });

  it('falls back to plain wording when the address names no whole table', () => {
    expect(linkProblemText('table-not-found', undefined, false).title).toBe(
      'Database the database of this link has no table the table of this link.',
    );
    expect(linkProblemText('agent-unreachable', undefined, false).title).toContain('this computer');
  });

  it('advises Chrome only where the browser may block loopback', () => {
    expect(linkProblemText('agent-unreachable', REF, true).hints.join(' ')).toContain('Chrome');
    expect(linkProblemText('agent-unreachable', REF, false).hints.join(' ')).not.toContain('Chrome');
    expect(linkProblemText('table-not-found', REF, true).hints.join(' ')).not.toContain('Chrome');
  });
});

describe('browserMayBlockLoopback (Decision 3)', () => {
  const SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0';
  const IOS_CHROME =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1';
  it.each([
    ['Safari', { userAgent: SAFARI }, true],
    ['Brave', { userAgent: CHROME, brave: {} }, true],
    ['Chrome on iOS (WebKit)', { userAgent: IOS_CHROME }, true],
    ['Chrome', { userAgent: CHROME }, false],
    ['Firefox', { userAgent: FIREFOX }, false],
  ])('%s', (_name, nav, blocks) => {
    expect(browserMayBlockLoopback(nav)).toBe(blocks);
  });
});
