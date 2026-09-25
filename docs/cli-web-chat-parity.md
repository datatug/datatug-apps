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
| Clear and delete session | Slash commands with confirmation | Confirmed controls in session bar | Yes |
| Composer and attached-context chips | Multiline input, chip navigation | Multiline input and focusable removable chips | Yes; browser uses Tab and Shift+Tab |
| Project workspace tab | Expandable source/kind/object tree with metadata | Expandable source/kind/schema/object and column cards with metadata and attach | Yes for catalog objects and actions; web adds schema grouping, keyboard navigation differs |
| Selected workspace tab | Current row/column/recordset inspector, durable selection | Row/column/recordset cards, source attribution, durable selection | Yes for current selection data; presentation differs |
| Docked workspace tab | Projected grids, attach, undock | Projected AG Grid cards and undock | Yes for data and actions; browser uses AG Grid navigation |
| Bookmarks workspace tab | Search/tag filter, preview, attach, dock, rename/tag/delete | Search/tag filter, preview, attach, dock, rename/tag/delete | Yes; browser uses focusable controls |
| Attachment state and workspace tab sync | Durable session workspace | Same CLI workspace actions; WebSocket refresh | Yes |
| Result table sorting | TUI grid | AG Grid | Yes, browser sort is presentation-only |
| Row/cell/range selection with source-row identity | TUI grid selection | AG Grid click and Shift-click writes CLI workspace | Yes for selection state; interaction follows browser conventions |
| Result charts and current-row view | Grid view switcher | Table, numeric bar chart, current row | Yes for view data; chart styling follows web theme |
| JOIN candidates and applying a JOIN | Grid join pane | Related-table cards and JOIN action | Yes for discovery and execution |
| Result refresh, version badges | Ctrl+R, version indicators | Refresh action, changed/unchanged badges, retained-version folding | Yes for retained history and comparison |
| Cell detail and related-record preview | Enter overlay | Selected card shows source, type, value, copy, and FK preview | Yes for data; presentation differs |
| HTTP result rendered/raw/header views | Focused HTTP response block | Message card with sanitized Markdown, raw body, and headers | Yes for supported response views |
| Export current/bucket | Grid keys and slash commands | Download format picker, result and bucket controls | Yes for formats and scoped snapshots; browser download capped at 16 MiB |
| Save project query | Grid or HTTP response overlay | Save query prompts for result or HTTP response | Yes for savable results; dialog presentation differs |
| Saved query picker and execution | `/query` picker and parameter form | Searchable inventory and parameter prompts for DTQL and HTTP in Tools | Yes for DTQL and HTTP |
| Result retention settings | `/settings versions` | Tools panel versions control | Yes |
| Connection preview | `/connect` read-only overlay | Tools panel read-only preview | Yes; connection switching is unimplemented in both |
| HTTP request form and header/cookie settings | `/http` dialog and commands | HTTP method, URL, headers, and body form; masked persistent header/cookie settings | Yes for request and settings actions; browser uses form controls |
| Provider/model selector | CLI launch option | Browser follows the CLI's active provider and model | CLI-owned; browser cannot switch a running provider |
| TUI key hints, mouse mode, pane resize, F5 | Terminal-specific controls | Browser-native interaction | Platform-specific |

The right panel matches the TUI's four workspace tabs and uses the same
session-scoped state. The browser Tools drawer holds TUI overlay equivalents.
The table records remaining screen gaps explicitly; passing the chat bridge
journey does not imply full feature parity.
