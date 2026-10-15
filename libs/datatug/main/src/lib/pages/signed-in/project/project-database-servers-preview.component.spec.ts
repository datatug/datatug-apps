import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DbServerService } from '../../../services/unsorted/db-server.service';
import { ProjectDatabaseServersPreviewComponent } from './project-database-servers-preview.component';

const ref = { storeId: 'localhost:8989', projectId: 'project-1' };

describe('project database connections preview', () => {
  async function create(getDbServers: ReturnType<typeof vi.fn>) {
    await TestBed.configureTestingModule({
      imports: [ProjectDatabaseServersPreviewComponent],
      providers: [{ provide: DbServerService, useValue: { getDbServers } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(
      ProjectDatabaseServersPreviewComponent,
    );
    fixture.componentRef.setInput('projectRef', ref);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('shows actual server summaries with exact detail links', async () => {
    const getDbServers = vi.fn(() =>
      of([
        {
          dbServer: {
            driver: 'postgresql',
            host: 'db.example.org',
            port: 5432,
          },
          databasesCount: 3,
        },
      ]),
    );
    const fixture = await create(getDbServers);
    expect(getDbServers).toHaveBeenCalledWith(ref);
    const link = fixture.nativeElement.querySelector('a');
    expect(link.textContent).toContain('db.example.org');
    expect(link.getAttribute('href')).toContain('/servers/db/postgresql/');
    expect(fixture.nativeElement.innerHTML).toContain('3 databases');
  });

  it('drops an old project response when the project changes', async () => {
    const pending = new Subject<unknown>();
    const getDbServers = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(of([]));
    const fixture = await create(getDbServers);
    fixture.componentRef.setInput('projectRef', {
      ...ref,
      projectId: 'second',
    });
    fixture.detectChanges();
    pending.next([
      { dbServer: { driver: 'sqlite3', host: 'stale' }, databasesCount: 1 },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.innerHTML).toContain(
      'No database connections are configured',
    );
    expect(fixture.nativeElement.innerHTML).not.toContain('stale');
  });
});
