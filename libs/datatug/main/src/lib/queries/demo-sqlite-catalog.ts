export type DemoSqliteDatasetId =
  | 'chinook'
  | 'northwind'
  | 'pubs'
  | 'employees'
  | 'adventureworks';

export interface DemoSqlitePart {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface DemoSqliteCatalogEntry {
  readonly dataset: DemoSqliteDatasetId;
  /** Canonical URL of the decoded SQLite file. */
  readonly url: string;
  /** SHA-256 of the decoded SQLite file. */
  readonly sha256: string;
  /** Byte size of the decoded SQLite file. */
  readonly bytes: number;
  readonly compression?: 'gzip';
  readonly parts?: readonly DemoSqlitePart[];
}

export const demoSqliteCatalog: Readonly<
  Record<DemoSqliteDatasetId, DemoSqliteCatalogEntry>
> = {
  chinook: {
    dataset: 'chinook',
    url: 'https://chinook.demodb.dev/data/chinook.sqlite',
    sha256: '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15',
    bytes: 1007616,
  },
  northwind: {
    dataset: 'northwind',
    url: 'https://northwind.demodb.dev/data/northwind.sqlite',
    sha256: '279b34136771aee75d802094b3329515a2b01da65d2a20a4a9e3b58c29b4fd20',
    bytes: 602112,
  },
  pubs: {
    dataset: 'pubs',
    url: 'https://pubs.demodb.dev/data/pubs.sqlite',
    sha256: 'b45b08b7c06441cc0b138b031ea5bd32bd5866aebf874c89d2ebf7fc6abb3691',
    bytes: 212992,
  },
  employees: {
    dataset: 'employees',
    url: 'https://employees.demodb.dev/data/employees.sqlite',
    sha256: '46b49dd0e141cd8db66d57680a10febfccc15e6f54dc7b8f3c2316b55e11c5f0',
    bytes: 876544,
  },
  adventureworks: {
    dataset: 'adventureworks',
    url: 'https://adventureworks.demodb.dev/data/adventureworks.sqlite',
    sha256: '6a105e1982becfe003fc7a307d7cad9d738390cedd79d166c2167fd817168109',
    bytes: 126820352,
    compression: 'gzip',
    parts: [
      {
        path: 'artifacts/adventureworks.sqlite.gz.part-0001',
        bytes: 26214400,
        sha256: '60e1d23ec00f1938e39262cd2e30a85a29aada525def56a65960312e1a9c5ac6',
      },
      {
        path: 'artifacts/adventureworks.sqlite.gz.part-0002',
        bytes: 9153059,
        sha256: '899a20c972a8f6fdd25b1544a29804c4872b877061dbaa1d6a85478445071e10',
      },
    ],
  },
};
