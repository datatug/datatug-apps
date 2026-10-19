import {
  createGrid,
  ModuleRegistry,
  ClientSideRowModelModule,
  CsvExportModule,
  type GridApi,
} from 'ag-grid-community';
import { ExcelExportModule, RowGroupingModule } from 'ag-grid-enterprise';
import {
  RAW_RESULT_EXCEL_STYLES,
  rawResultCell,
  skipResultSummaryRow,
} from './results-grid-export';

/** getDataAsExcel returns the real workbook as a stored ZIP (no new ZIP dependency needed). */
async function workbookFiles(blob: Blob): Promise<Map<string, string>> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Workbook read failed'));
    reader.readAsArrayBuffer(blob);
  });
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer),
    files = new Map<string, string>();
  let offset = 0;
  while (
    offset + 30 <= bytes.length &&
    view.getUint32(offset, true) === 0x04034b50
  ) {
    expect(view.getUint16(offset + 8, true)).toBe(0); // native synchronous export is uncompressed
    const length = view.getUint32(offset + 18, true),
      nameLength = view.getUint16(offset + 26, true),
      extra = view.getUint16(offset + 28, true);
    const nameStart = offset + 30,
      dataStart = nameStart + nameLength + extra;
    const name = new TextDecoder().decode(
      bytes.subarray(nameStart, nameStart + nameLength),
    );
    files.set(
      name,
      new TextDecoder().decode(bytes.subarray(dataStart, dataStart + length)),
    );
    offset = dataStart + length;
  }
  return files;
}

function sheetRows(files: Map<string, string>): string[][] {
  const parser = new DOMParser();
  const shared = parser.parseFromString(
    files.get('xl/sharedStrings.xml') ?? '',
    'application/xml',
  );
  const strings = [...shared.querySelectorAll('si')].map(
    (si) => si.querySelector('t')?.textContent ?? '',
  );
  const sheet = parser.parseFromString(
    files.get('xl/worksheets/sheet1.xml') ?? '',
    'application/xml',
  );
  return [...sheet.querySelectorAll('row')].map((row) =>
    [...row.querySelectorAll('c')].map((cell) => {
      const value = cell.querySelector('v')?.textContent ?? '';
      return cell.getAttribute('t') === 's' ? strings[Number(value)] : value;
    }),
  );
}

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  CsvExportModule,
  ExcelExportModule,
  RowGroupingModule,
]);

describe('native AG Excel serialization of raw result leaves', () => {
  const apis: GridApi[] = [];
  afterEach(() => {
    for (const api of apis.splice(0)) api.destroy();
    document.body.replaceChildren();
  });
  function grid(text: boolean) {
    const host = document.createElement('div');
    document.body.append(host);
    const api = createGrid(host, {
      theme: 'legacy',
      // Happy DOM does not implement the browser's innerText=null coercion for empty auto-group leaves.
      // This non-exported column's formatter leaves native workbook/CSV serialization untouched.
      autoGroupColumnDef: { valueFormatter: p => String(p.value ?? '') },
      ...(text ? { excelStyles: RAW_RESULT_EXCEL_STYLES } : {}),
      columnDefs: [
        { field: 'country', rowGroup: true, hide: true },
        { field: 'id' },
        { field: 'amount' },
        { field: 'precise' },
      ],
      groupTotalRow: 'bottom',
      groupDefaultExpanded: -1,
      rowData: [
        {
          country: 'Canada',
          id: '9007199254740993',
          amount: '2.50',
          precise: '0.1000000000000000001',
        },
        {
          country: 'USA',
          id: '-9007199254740993',
          amount: null,
          precise: '1.0000000000000001',
        },
      ],
    });
    apis.push(api);
    return api;
  }
  it('demonstrates native numeric-string rounding then preserves every raw digit/zero in an actual text-typed workbook', async () => {
    const options = {
      columnKeys: ['id', 'amount', 'precise'],
      skipRowGroups: true,
      shouldRowBeSkipped: skipResultSummaryRow,
      processCellCallback: rawResultCell,
    };
    const inferred = sheetRows(
      await workbookFiles(grid(false).getDataAsExcel(options) as Blob),
    );
    expect(inferred[1][0]).toBe('9007199254740992'); // negative control: callback alone is insufficient
    const files = await workbookFiles(
      grid(true).getDataAsExcel(options) as Blob,
    );
    expect(sheetRows(files)).toEqual([
      ['Id', 'Amount', 'Precise'],
      ['9007199254740993', '2.50', '0.1000000000000000001'],
      ['-9007199254740993', '', '1.0000000000000001'],
    ]);
    const sheet = new DOMParser().parseFromString(
      files.get('xl/worksheets/sheet1.xml') ?? '',
      'application/xml',
    );
    expect(
      [...sheet.querySelectorAll('row:nth-child(n+2) c')]
        .filter((cell) => cell.querySelector('v'))
        .every((cell) => cell.getAttribute('t') === 's'),
    ).toBe(true);
  });
  it('exports only real leaves to CSV despite native group/footer rows', () => {
    const api = grid(true);
    const withFooters = api.getDataAsCsv({
      columnKeys: ['id'],
      skipRowGroups: true,
      processCellCallback: rawResultCell,
    });
    expect(withFooters?.split(/\r?\n/).length).toBeGreaterThan(3);
    const csv = api.getDataAsCsv({
      columnKeys: ['id'],
      skipRowGroups: true,
      shouldRowBeSkipped: skipResultSummaryRow,
      processCellCallback: rawResultCell,
    });
    expect(csv?.split(/\r?\n/)).toEqual([
      '"Id"',
      '"9007199254740993"',
      '"-9007199254740993"',
    ]);
  });
});
