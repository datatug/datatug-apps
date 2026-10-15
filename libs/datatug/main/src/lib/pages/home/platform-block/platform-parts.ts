export type PlatformStatus = 'available' | 'planned';

export const PLATFORM_STATUS_LABEL: Readonly<Record<PlatformStatus, string>> = {
  available: 'Available',
  planned: 'Planned',
};

export interface PlatformMechanism {
  readonly id: 'terminal-app' | 'skills' | 'mcp-server' | 'mcp-web-app';
  readonly label: string;
  readonly status: PlatformStatus;
}

export interface PlatformPart {
  readonly id: 'terminal' | 'agent';
  readonly name: string;
  readonly line: string;
  readonly icon: string;
  readonly href: string;
  readonly linkLabel: string;
  readonly mechanisms: readonly PlatformMechanism[];
}

export const PLATFORM_TITLE = 'Other ways to use DataTug';
export const PLATFORM_LEDE =
  'Use the same project knowledge from a terminal or connect it to your AI agent.';

export const PLATFORM_PARTS: readonly PlatformPart[] = [
  {
    id: 'terminal',
    name: 'Terminal / CLI',
    line: 'Browse project data and run saved SQL or TugQL queries in a keyboard-driven app with the datatug CLI.',
    icon: 'terminal-outline',
    href: 'https://datatug.io/apps/cli/',
    linkLabel: 'Explore the terminal app',
    mechanisms: [
      { id: 'terminal-app', label: 'Terminal app', status: 'available' },
    ],
  },
  {
    id: 'agent',
    name: 'Integrate with your AI agent',
    line: 'Today, Claude Code can use DataTug CLI skills. An MCP server and an embedded MCP web app for interactive views in agent conversations are planned.',
    icon: 'sparkles-outline',
    href: 'https://datatug.ai/skills/',
    linkLabel: 'Explore DataTug skills',
    mechanisms: [
      { id: 'skills', label: 'CLI skills', status: 'available' },
      { id: 'mcp-server', label: 'MCP server', status: 'planned' },
      { id: 'mcp-web-app', label: 'MCP web app', status: 'planned' },
    ],
  },
];
