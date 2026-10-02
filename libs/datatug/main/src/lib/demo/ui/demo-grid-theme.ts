/**
 * The DataTug AG Grid theme (AG Grid v36 Theming API), aligned with the one the DataTug.ai site ships
 * (datatug/datatug-io, branch datatug-ai-site, packages/site-kit/src/grid/theme.ts: `createDatatugGridTheme`).
 *
 * Every colour is a CSS custom property, so the grid follows the app's light and dark Ionic theme with no
 * second theme object. The host sets the `--dt-grid-*` properties from Ionic's variables
 * (see demo-result.component.scss); the site sets them from its own tokens. Same parameters, one look.
 */
import { themeQuartz, type Theme } from 'ag-grid-community';

export const datatugGridParams = {
  backgroundColor: 'var(--dt-grid-bg)',
  foregroundColor: 'var(--dt-grid-fg)',
  chromeBackgroundColor: 'var(--dt-grid-header-bg)',
  headerBackgroundColor: 'var(--dt-grid-header-bg)',
  headerTextColor: 'var(--dt-grid-muted)',
  borderColor: 'var(--dt-grid-border)',
  rowHoverColor: 'var(--dt-grid-row-hover)',
  selectedRowBackgroundColor: 'var(--dt-grid-row-selected)',
  accentColor: 'var(--dt-grid-accent)',
  fontFamily: 'inherit',
  fontSize: 13.5,
  headerFontSize: 12.5,
  headerFontWeight: 600,
  spacing: 7,
  rowVerticalPaddingScale: 1.05,
  headerVerticalPaddingScale: 1.1,
  wrapperBorderRadius: 0,
  borderRadius: 6,
  cellHorizontalPaddingScale: 1.1,
  headerColumnBorder: false,
  columnBorder: false,
  rowBorder: true,
  wrapperBorder: false,
} as const;

export const createDatatugGridTheme = (): Theme => themeQuartz.withParams({ ...datatugGridParams });
