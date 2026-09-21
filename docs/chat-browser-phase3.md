# Browser Chat Phase 3: workspace and structured context

## Journey

Open a project Chat session. The chat history and its saved result grids appear beside a workspace with Project, Selected, and Docked tabs. Browsing the project tree leaves chat context unchanged. Attach a table explicitly; its chip appears in the composer. Ask a question and receive a new persisted RecordSet. Select rows or a cell in that grid; the Selected tab shows the exact saved values and a durable Selection referencing the original row positions. Attach or dock that Selection. Ask a follow-up about "them"; the model sees stable Selection identity and column metadata, while DataTug resolves selected IDs locally. Reload with no further action: the chat, attachment chips, selection, and dock reopen without querying historical data. Switching sessions shows only that session's workspace. Clearing or deleting a session removes its workspace objects.

## Domain boundary

- Immutable RecordSets stay in `ChatRecordSets` from Phase 2. Views hold source row indexes and visible columns. Selections hold their own row, column, and cell-range coordinates; sorting a grid cannot change their source identity.
- The session owns views, selections, attachments, docks, and active workspace tab. The DALgo `Database` injection token remains the only persistence boundary, so another DALgo backend can replace IndexedDB later.
- Navigation and focus do not attach context. Only explicit attach/detach or a docked item can provide selected values to a follow-up query. The current Selection's ID and metadata support a workspace command such as "Dock them"; an attempt to bind it into a query before attaching or docking fails clearly. No row values are sent to the provider.
- Browser UI controls and model-issued workspace actions call the same application operation. A model action is validated against the active session and project catalog before it changes workspace state.
- The initial project explorer shows the real locally available Chinook source and its eleven tables. Views and project queries are shown only when the project actually supplies them.

## Verification

- Deterministic tests cover view/selection creation, multiple selections, attachment/dock lifecycle, session isolation, and local selected-ID binding.
- Browser journeys cover explicit table attachment, model and UI selection/docking, multirow and shift-click cell-range selection, Selected details, stable source rows after sorting, reload, session switching, context isolation, and a related follow-up query using persisted selection values. Local selection and docking add no new RecordSet or database query.
