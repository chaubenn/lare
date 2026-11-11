//! Monaco edit log: the compact change tuples the extension sends in `edits.batch` frames. The
//! TypeScript side is `packages/shared/src/session/edits.ts` (which also replays them);
//! `packages/shared/fixtures/bridge.json` keeps the two shapes in step.

use serde::{Deserialize, Serialize};

/// `[rangeOffset, rangeLength, text]` in the pre-event text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditChange(pub usize, pub usize, pub String);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditEvent {
    /// Epoch milliseconds.
    pub t: u64,
    /// Monaco model version id after this event.
    pub v: u64,
    /// Changes in this event.
    pub c: Vec<EditChange>,
    /// Full model text after this event (snapshot).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full: Option<String>,
}
