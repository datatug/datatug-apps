# Browser Chat Phase 2: durable sessions

## Journey

Open a project's Chat page to restore its latest session, messages, and saved grids. A new question is saved before contacting the selected AI provider. When the local query finishes, the executed query and its RecordSet snapshot are saved together with the completed turn. A refresh or browser restart loads that snapshot; it does not run the query again. The session selector can create, switch, rename, clear, and delete independent sessions. Clear keeps the session name and removes its messages, queries, and snapshots. Delete removes the session and all of those records.

## Storage boundary

`ChatSessionService` uses the `@dalgo/core` `Database` contract through the `CHAT_SESSION_DATABASE` injection token. Its current factory supplies `@dalgo/indexeddb` in the browser. A future cloud or OpenVaultDB option can supply another DALgo database through this token while keeping the Chat page and session model. Provider API keys remain in the existing browser settings store; they are not session records.

The current adapter uses the `datatug-chat-sessions` IndexedDB database with four DALgo collections and named object stores: `ChatSessions`, `ChatTurns`, `ChatQueries`, and `ChatRecordSets`. Session records include a project scope, stable UUID, title, timestamps, and the IDs of their child records. Query records contain exact DTQL, YAML, SQLite rendering, source identity, execution time, column names, and row count. RecordSets contain copied rows, column names, a stable UUID, the query ID, source identity, creation time, and metrics. Each query execution gets fresh query and RecordSet IDs; prior snapshots are never updated.

DALgo readwrite transactions save a pending question with its session before the provider call, then save the completed query, RecordSet, turn, and session metadata atomically. Clear and delete remove all referenced child records in a transaction. A missing child or invalid session metadata surfaces as a load error; the app never silently reruns an old query. Another session remains selectable if one is damaged.

For a follow-up request, the browser rebuilds bounded context from recent questions, exact DTQL, RecordSet IDs, column names, and row counts. Result row and cell values stay in local storage and are not copied into the AI request. This preserves the Phase 1 direct provider flow and leaves row selection, docking, and bookmarks for later phases.
