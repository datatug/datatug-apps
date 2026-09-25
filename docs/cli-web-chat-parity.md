# CLI and browser chat screen parity

This inventory compares the CLI-owned TUI (`datatug-cli/pkg/chat/chatui*.go`,
`chatui_sidepanel.go`) with the browser route
`store/:storeId/project/:projectId/chat` (`cli-chat-page.component.ts`). It
describes the CLI bridge, not the browser's separate local Chinook chat.
The CLI session remains the source of truth. Browser changes use the loopback
bridge and WebSocket notifications; result rows are not copied into browser
persistence.

| Screen element or action | TUI | CLI-backed web chat | Parity |
| --- | --- | --- | --- |
| Transcript: user/assistant cards and query result cards | Yes | Yes | Yes |
| Send a message, receive TUI changes live | Yes | Yes | Yes |
| Project identity and navigation | Header, F3 project picker | Project route and side menu | Partial: browser project routes outside chat require a fuller local project API |
| Session title, list, new, switch, rename | F4 and slash commands | Session bar backed by CLI | Yes |
| Clear and delete session | Slash commands with confirmation | Not exposed | Pending approval for irreversible browser actions |
| Composer and attached-context chips | Multiline input, chip navigation | Multiline input and removable chips | Partial: browser chips have no TUI-style keyboard selection |
| Project workspace tab | Expandable source/object tree with metadata | Source groups and project object cards with metadata and attach | Partial: no schema-level tree |
| Selected workspace tab | Current row/column/recordset inspector, durable selection | Row/column/recordset cards and durable selection | Partial: no FK attribution in column inspector |
| Docked workspace tab | Projected grids, attach, undock | Projected AG Grid cards and undock | Partial: fewer grid keyboard actions |
| Bookmarks workspace tab | Search/tag filter, preview, attach, dock, rename/tag/delete | Search/tag filter, preview, attach, dock, rename/tag/delete | Yes for core bookmark actions; keyboard flows differ |
| Attachment state and workspace tab sync | Durable session workspace | Same CLI workspace actions; WebSocket refresh | Yes |
| Result table sorting | TUI grid | AG Grid | Yes, browser sort is presentation-only |
| Row/cell selection with source-row identity | TUI grid selection | AG Grid selection writes CLI workspace | Partial: no range selection |
| Result charts and current-row view | Grid view switcher | Table, numeric bar chart, current row | Partial: chart styles differ |
| JOIN candidates and applying a JOIN | Grid join pane | Related-table cards and JOIN action | Yes for discovery and execution; keyboard navigation differs |
| Result refresh, version badges | Ctrl+R, version indicators | Refresh action, refreshed badge, new result card | Partial: no history folding or change comparison |
| Cell detail and related-record preview | Enter overlay | Selected card shows value only | Missing |
| HTTP result rendered/raw/header views | Focused HTTP response block | Message card with rendered text, raw body, and headers | Partial: rendered text has no Markdown styling |
| Export current/bucket, save query, export bucket | Grid keys and slash commands | Not exposed | Missing |
| Model/provider settings, connect, HTTP/query dialogs | Slash commands and overlays | Not exposed | Missing |
| TUI key hints, mouse mode, pane resize, F5 | Terminal-specific controls | Browser-native interaction | Platform-specific |

The right panel matches the TUI's four workspace tabs and uses the same
session-scoped state. The table records remaining screen gaps explicitly;
passing the chat bridge journey does not imply full feature parity.
