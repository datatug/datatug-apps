// Public API entry — see ../public_api.ts.
//
// Bump this whenever a field is added, renamed or removed relative to
// `datatug-core/pkg/datatug/boards.go` (the source of truth), so a consumer
// (e.g. Dashboardius) pinned to a version can detect drift instead of
// silently reading a shape that changed under it.
export const BOARD_MODELS_VERSION = '0.1.0';
