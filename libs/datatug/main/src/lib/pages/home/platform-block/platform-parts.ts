// What DataTug consists of, for the "One platform, four ways in." block on the home page. The same four parts, in
// the same order, with the same wording and statuses as the block datatug.io and datatug.ai show near the top
// (founder, 2026-10-03: "I want user to be explained scope of project early. So I see that at all 3 DataTug
// sites."). The sites' source is repo datatug/websites: packages/site-kit/src/platform.ts (parts and links),
// strings.ts (`platform`, the words) and features.ts (the registry the statuses come from). This app does not depend
// on the site kit, so the wording is copied here and the statuses are held in this one constant: when a registry
// status changes, change it here too (each chip names the registry id it mirrors).

export type PlatformPartId = 'app' | 'terminal' | 'skills' | 'mcp-app';

/** The two statuses a part has today; the sites' registry has more (preview, in-development, exploring). */
export type PlatformStatus = 'available' | 'planned';

export const PLATFORM_STATUS_LABEL: Readonly<Record<PlatformStatus, string>> = {
  available: 'Available',
  planned: 'Planned',
};

export interface PlatformChip {
  /** The id of the datatug/websites feature registry entry this status mirrors. */
  readonly feature:
    | 'web-app'
    | 'tui-app'
    | 'skills-plugin'
    | 'mcp-server'
    | 'uibubbles-runtime';
  readonly status: PlatformStatus;
  /** Names the chip of a part that has several; a part with one chip shows its status alone. */
  readonly label?: string;
}

export interface PlatformPart {
  readonly id: PlatformPartId;
  readonly name: string;
  readonly line: string;
  /** Ionicons name (kebab-case), registered by the component. */
  readonly icon: string;
  /** Where the part's card goes; absent for DataTug.app itself, which is where the visitor already is. */
  readonly href?: string;
  readonly chips: readonly PlatformChip[];
}

export const PLATFORM_TITLE = 'One platform, four ways in.';
export const PLATFORM_LEDE =
  'Work in the browser or the terminal, or let your coding agent do it. Each part shows how finished it is.';

export const PLATFORM_PARTS: readonly PlatformPart[] = [
  {
    id: 'app',
    name: 'DataTug.app',
    line: 'The web app: explore, query and chat over your data in the browser.',
    icon: 'browsers-outline',
    chips: [{ feature: 'web-app', status: 'available' }],
  },
  {
    id: 'terminal',
    name: 'Terminal app',
    line: 'The same projects in a keyboard-driven terminal UI: run datatug.',
    icon: 'terminal-outline',
    href: 'https://datatug.io/apps/cli/',
    chips: [{ feature: 'tui-app', status: 'available' }],
  },
  {
    id: 'skills',
    name: 'AI skills',
    line: 'Your coding agent uses DataTug as a tool: skills for the CLI, and an MCP server.',
    icon: 'sparkles-outline',
    href: 'https://datatug.ai/skills/',
    chips: [
      { feature: 'skills-plugin', status: 'available', label: 'Skills plugin' },
      { feature: 'mcp-server', status: 'planned', label: 'MCP server' },
    ],
  },
  {
    id: 'mcp-app',
    name: 'MCP web app',
    line: "Interactive DataTug views inside your agent's chat.",
    icon: 'chatbubbles-outline',
    href: 'https://datatug.ai/#way-agent',
    chips: [{ feature: 'uibubbles-runtime', status: 'planned' }],
  },
];
