# Actual retained comparison wire provenance

Copied byte-for-byte from actual native Go DAL/SQLite/registered-handler tests, not browser interception or a signed/live claim. Producer root-owned Backend6ac3bb67279f73856410186ab7d526efbf4d6c53; recovery opt-in export test-only successor7f491c792ee0cedcd722921d4750e2b93f5c2506. Backend comparison source independently reviewed; root owns publication.

- comparison-facade.go.json SHA256 f8681827d43714af903d313c210af247fbd238465f47d7213d4fdded5f835ea5 (facade-wire.json).
- comparison-http.go.json SHA256 8c46c133f2bf9d85063e70180d8f9873cd1ad6ddfc96a12805729aad4a176076 (http-wire.json).
- comparison-recovery.go.json SHA256 33cfa1f322eba2c1f72ca60e0b9377bcb2e90dcf3cfc6c6001450c3c5b6fcaa2 (recovery-wire.json).

Source receipts under /private/tmp/datatug-retained-comparison-backend; source review/recovery-export review are root-owned. JSON fields, flat TypedValue wire, original rows/order, source pins, selectors, receipts and raw logs are unmodified. Recovery fixture proves actual correction has no new lane, explicit replay adds the real recovery attempt, independent11062 reuse and historical opens. Tests do not install a saved query/board or grant source authority.
