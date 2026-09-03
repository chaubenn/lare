//! Monaco edit log: compact change tuples and replay (mirrors packages/shared/src/edits.ts).

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditLog {
    pub version: u32,
    pub slug: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub events: Vec<EditEvent>,
}

#[derive(Debug, thiserror::Error)]
pub enum ReplayError {
    #[error("edit offset {offset} beyond text length {len}")]
    OutOfRange { offset: usize, len: usize },
}

/// Apply one event to `text` (UTF-16 code unit offsets, as Monaco reports them).
pub fn apply_event(text: &str, event: &EditEvent) -> Result<String, ReplayError> {
    if let Some(full) = &event.full {
        return Ok(full.clone());
    }
    // Work in UTF-16 units to match JavaScript string indexing.
    let mut units: Vec<u16> = text.encode_utf16().collect();
    let mut changes: Vec<&EditChange> = event.c.iter().collect();
    changes.sort_by(|a, b| b.0.cmp(&a.0));
    for EditChange(offset, length, insert) in changes {
        if *offset > units.len() {
            return Err(ReplayError::OutOfRange {
                offset: *offset,
                len: units.len(),
            });
        }
        let end = (*offset + *length).min(units.len());
        let insert_units: Vec<u16> = insert.encode_utf16().collect();
        units.splice(*offset..end, insert_units);
    }
    Ok(String::from_utf16_lossy(&units))
}

/// Text at time `t` (inclusive), starting from the latest snapshot at or before `t`.
pub fn code_at(events: &[EditEvent], t: u64, initial: &str) -> Result<String, ReplayError> {
    let mut base = initial.to_string();
    let mut start = 0usize;
    for (i, e) in events.iter().enumerate().rev() {
        if e.t <= t {
            if let Some(full) = &e.full {
                base = full.clone();
                start = i + 1;
                break;
            }
        }
    }
    let mut text = base;
    for e in &events[start..] {
        if e.t > t {
            break;
        }
        text = apply_event(&text, e)?;
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(t: u64, v: u64, c: Vec<(usize, usize, &str)>, full: Option<&str>) -> EditEvent {
        EditEvent {
            t,
            v,
            c: c.into_iter().map(|(o, l, x)| EditChange(o, l, x.to_string())).collect(),
            full: full.map(str::to_string),
        }
    }

    #[test]
    fn applies_in_reverse_offset_order() {
        // Pre-change offsets 0 and 1 of "ab", sent in either order.
        let e = ev(0, 1, vec![(0, 0, "1"), (1, 0, "1")], None);
        assert_eq!(apply_event("ab", &e).unwrap(), "1a1b");
        let e2 = ev(0, 1, vec![(1, 0, "1"), (0, 0, "1")], None);
        assert_eq!(apply_event("ab", &e2).unwrap(), "1a1b");
        // Offset 2 is the end of "ab".
        let e3 = ev(0, 1, vec![(0, 0, "1"), (2, 0, "1")], None);
        assert_eq!(apply_event("ab", &e3).unwrap(), "1ab1");
    }

    #[test]
    fn replays_with_snapshots() {
        let events = vec![
            ev(1000, 1, vec![], Some("class Solution:\n")),
            ev(2000, 2, vec![(16, 0, "    pass\n")], None),
            ev(3000, 3, vec![], Some("done")),
            ev(4000, 4, vec![(4, 0, "!")], None),
        ];
        assert_eq!(code_at(&events, 500, "").unwrap(), "");
        assert_eq!(code_at(&events, 2500, "").unwrap(), "class Solution:\n    pass\n");
        assert_eq!(code_at(&events, 9999, "").unwrap(), "done!");
    }

    #[test]
    fn utf16_offsets_match_javascript() {
        // "é" is one UTF-16 unit; "😀" is two.
        let e = ev(0, 1, vec![(3, 0, "x")], None);
        assert_eq!(apply_event("é😀", &e).unwrap(), "é😀x");
        let e2 = ev(0, 1, vec![(1, 2, "")], None);
        assert_eq!(apply_event("é😀", &e2).unwrap(), "é");
    }

    #[test]
    fn json_roundtrip_matches_ts_shape() {
        let e = ev(1, 2, vec![(3, 4, "abc")], Some("full"));
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(json, r#"{"t":1,"v":2,"c":[[3,4,"abc"]],"full":"full"}"#);
        let back: EditEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(back, e);
    }
}
