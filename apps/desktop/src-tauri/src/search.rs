//! Local search for the command palette: one Zvec collection per signed-in user under the app
//! data dir. The frontend fills it from Supabase (`features/search/sync.ts`) and queries it as the
//! user types; the doc shapes come from `packages/shared/src/search/search.ts`.
//!
//! Two full-text fields do the matching. `grams` holds the short docs (sessions, posts, people)
//! cut into 2–3 character ngrams and is queried with AND, so "palin" finds "Valid Palindrome"
//! while it is still being typed. `words` holds what was said in an interview (transcripts and
//! AI reviews): ngrams over an hour of speech would match almost anything, so those match whole,
//! stemmed words instead.
//!
//! Zvec's Windows build runs AVX instructions while its DLL loads, which kills the process on
//! a CPU without them. `build.rs` delay-loads the DLL, and [`engine`] checks the CPU before the
//! first call into it, so such a machine never maps the DLL and the palette falls back to its
//! own substring search.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::{info, warn};
use zvec_rust::{
    Collection, CollectionSchema, ConfigBuilder, DataType, Doc, FieldSchema, Fts, FtsQueryParams,
    IndexParams, SearchQuery,
};

/// Bumped whenever the schema changes; an index from an older version is simply rebuilt.
const SCHEMA_VERSION: &str = "v1";
const KINDS: [&str; 5] = ["session", "said", "post", "draft", "person"];
const SAID: &str = "said";
const OUTPUT_FIELDS: [&str; 5] = ["kind", "title", "subtitle", "route", "at"];
const UPSERT_CHUNK: usize = 256;
/// Every match of a short query comes back so the palette can put the newest first.
const GRAMS_TOPK: i32 = 200;
const WORDS_TOPK: i32 = 50;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDoc {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub route: String,
    pub at: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub route: String,
    pub at: i64,
    pub score: f32,
}

/// What the frontend has already indexed, kept beside the collection so a wiped index is
/// refilled from scratch rather than trusting a watermark it no longer matches.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub transcripts_since: Option<String>,
    pub reviews_since: Option<String>,
}

/// Starts Zvec once per process. The error is kept and returned on every later call, so a
/// machine that cannot run it keeps falling back without retrying.
fn engine() -> Result<(), String> {
    static ENGINE: OnceLock<Result<(), String>> = OnceLock::new();
    ENGINE
        .get_or_init(|| {
            #[cfg(target_arch = "x86_64")]
            if !std::arch::is_x86_feature_detected!("avx2") {
                return Err("the search index needs a CPU with AVX2".into());
            }
            let config = ConfigBuilder::new().num_threads(2).build();
            zvec_rust::initialize(Some(&config))
                .map_err(|e| format!("could not start the search index: {e}"))
        })
        .clone()
}

fn schema() -> zvec_rust::Result<CollectionSchema> {
    let grams = IndexParams::fts(
        Some("ngram"),
        Some(&["lowercase"]),
        Some(r#"{"ngram_min":2,"ngram_max":3,"token_chars":["letter","digit"]}"#),
    )?;
    let words = IndexParams::fts(Some("standard"), Some(&["lowercase", "stemmer"]), None)?;
    CollectionSchema::builder("palette")
        .add_indexed_field("kind", DataType::String, IndexParams::invert(false, false)?)
        .add_field(FieldSchema::new("title", DataType::String, false, 0)?)
        .add_field(FieldSchema::new("subtitle", DataType::String, false, 0)?)
        .add_field(FieldSchema::new("route", DataType::String, false, 0)?)
        .add_field(FieldSchema::new("at", DataType::Int64, false, 0)?)
        .add_indexed_field("grams", DataType::String, grams)
        .add_indexed_field("words", DataType::String, words)
        .build()
}

struct Open {
    user_id: String,
    dir: PathBuf,
    collection: Collection,
}

pub struct SearchIndex {
    root: PathBuf,
    open: Mutex<Option<Open>>,
}

impl SearchIndex {
    /// `root` is the app data dir; collections live under `search/<version>/<user id>`.
    pub fn new(root: PathBuf) -> Self {
        Self {
            root: root.join("search").join(SCHEMA_VERSION),
            open: Mutex::new(None),
        }
    }

    /// Opens (creating if need be) the signed-in user's collection and returns how far it has
    /// been filled. Switching users closes the previous one.
    pub fn open(&self, user_id: &str) -> Result<SyncState, String> {
        engine()?;
        // A uuid, so the id can never walk out of the search dir.
        let user_id = uuid::Uuid::parse_str(user_id)
            .map_err(|_| "not a user id".to_string())?
            .to_string();
        let mut open = self
            .open
            .lock()
            .map_err(|_| "search index lock poisoned".to_string())?;
        if let Some(current) = open.as_ref().filter(|o| o.user_id == user_id) {
            return Ok(read_sync(&current.dir));
        }
        *open = None;
        let dir = self.root.join(&user_id);
        let collection = open_collection(&dir)?;
        let state = read_sync(&dir);
        *open = Some(Open {
            user_id,
            dir,
            collection,
        });
        Ok(state)
    }

    /// Writes `docs`, first dropping every doc of each kind in `replace_kinds` (those are sent
    /// whole on every sync, which is how a deleted session or an unfollow leaves the index).
    pub fn index(
        &self,
        docs: &[SearchDoc],
        replace_kinds: &[String],
        sync: &SyncState,
    ) -> Result<(), String> {
        for kind in replace_kinds
            .iter()
            .map(String::as_str)
            .chain(docs.iter().map(|d| d.kind.as_str()))
        {
            if !KINDS.contains(&kind) {
                return Err(format!("unknown search kind: {kind}"));
            }
        }
        let open = self
            .open
            .lock()
            .map_err(|_| "search index lock poisoned".to_string())?;
        let open = open.as_ref().ok_or("the search index is not open")?;
        for kind in replace_kinds {
            open.collection
                .delete_by_filter(&format!("kind = '{kind}'"))
                .map_err(err)?;
        }
        for chunk in docs.chunks(UPSERT_CHUNK) {
            let built = chunk
                .iter()
                .map(to_doc)
                .collect::<zvec_rust::Result<Vec<_>>>()
                .map_err(err)?;
            open.collection
                .upsert(&built.iter().collect::<Vec<_>>())
                .map_err(err)?;
        }
        open.collection.flush().map_err(err)?;
        write_sync(&open.dir, sync)
    }

    /// Hits for `text`: short docs containing every ngram of it, then interview text containing
    /// every word of it. Ordering for display is left to the palette.
    pub fn query(&self, text: &str) -> Result<Vec<SearchHit>, String> {
        let text = text.trim();
        if text.chars().filter(|c| c.is_alphanumeric()).count() < 2 {
            return Ok(Vec::new());
        }
        let open = self
            .open
            .lock()
            .map_err(|_| "search index lock poisoned".to_string())?;
        let open = open.as_ref().ok_or("the search index is not open")?;
        let mut hits = run_query(&open.collection, "grams", text, GRAMS_TOPK)?;
        hits.extend(run_query(&open.collection, "words", text, WORDS_TOPK)?);
        Ok(hits)
    }
}

fn err(e: zvec_rust::Error) -> String {
    e.to_string()
}

/// An index that cannot be opened is only a cache of Supabase rows, so it is rebuilt.
fn open_collection(dir: &Path) -> Result<Collection, String> {
    let path = dir.to_str().ok_or("search index path is not UTF-8")?;
    if dir.exists() {
        match Collection::open(path, None) {
            Ok(collection) => return Ok(collection),
            Err(e) => {
                warn!(%e, "search index would not open; rebuilding it");
                let _ = std::fs::remove_dir_all(dir);
            }
        }
    }
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let collection =
        Collection::create_and_open(path, &schema().map_err(err)?, None).map_err(err)?;
    info!("created a search index");
    Ok(collection)
}

fn sync_path(dir: &Path) -> PathBuf {
    dir.with_extension("sync.json")
}

fn read_sync(dir: &Path) -> SyncState {
    std::fs::read(sync_path(dir))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_sync(dir: &Path, sync: &SyncState) -> Result<(), String> {
    let bytes = serde_json::to_vec(sync).map_err(|e| e.to_string())?;
    std::fs::write(sync_path(dir), bytes).map_err(|e| e.to_string())
}

fn to_doc(doc: &SearchDoc) -> zvec_rust::Result<Doc> {
    let mut out = Doc::new()?;
    out.set_pk(&doc.id);
    out.add_string("kind", &doc.kind)?;
    out.add_string("title", &doc.title)?;
    out.add_string("subtitle", &doc.subtitle)?;
    out.add_string("route", &doc.route)?;
    out.add_i64("at", doc.at)?;
    let all = format!("{} {}", doc.title, doc.text);
    let (grams, words) = if doc.kind == SAID {
        ("", all.as_str())
    } else {
        (all.as_str(), "")
    };
    out.add_string("grams", grams)?;
    out.add_string("words", words)?;
    Ok(out)
}

fn run_query(
    collection: &Collection,
    field: &str,
    text: &str,
    topk: i32,
) -> Result<Vec<SearchHit>, String> {
    let mut fts = Fts::new().map_err(err)?;
    fts.set_match_string(text).map_err(err)?;
    let mut query = SearchQuery::fts(field, &fts, topk).map_err(err)?;
    query
        .set_fts_params(FtsQueryParams::new(Some("AND")).map_err(err)?)
        .map_err(err)?;
    query.set_output_fields(&OUTPUT_FIELDS).map_err(err)?;
    let results = collection.query(&query).map_err(err)?;
    results
        .iter()
        .map(|doc| {
            let string = |name: &str| doc.get_string(name).map(Option::unwrap_or_default);
            Ok(SearchHit {
                id: doc.get_pk().unwrap_or_default().to_string(),
                kind: string("kind")?,
                title: string("title")?,
                subtitle: string("subtitle")?,
                route: string("route")?,
                at: doc.get_i64("at")?.unwrap_or_default(),
                score: doc.get_score(),
            })
        })
        .collect::<zvec_rust::Result<Vec<_>>>()
        .map_err(err)
}

type Index<'a> = State<'a, Arc<SearchIndex>>;

#[tauri::command]
pub async fn search_open(index: Index<'_>, user_id: String) -> Result<SyncState, String> {
    let index = index.inner().clone();
    tauri::async_runtime::spawn_blocking(move || index.open(&user_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn search_index(
    index: Index<'_>,
    docs: Vec<SearchDoc>,
    replace_kinds: Vec<String>,
    sync: SyncState,
) -> Result<(), String> {
    let index = index.inner().clone();
    tauri::async_runtime::spawn_blocking(move || index.index(&docs, &replace_kinds, &sync))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn search_query(index: Index<'_>, text: String) -> Result<Vec<SearchHit>, String> {
    let index = index.inner().clone();
    tauri::async_runtime::spawn_blocking(move || index.query(&text))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const USER: &str = "6f2c9e0a-1b2c-4d3e-8f90-0a1b2c3d4e5f";

    fn doc(id: &str, kind: &str, title: &str, at: i64, text: &str) -> SearchDoc {
        SearchDoc {
            id: id.into(),
            kind: kind.into(),
            title: title.into(),
            subtitle: String::new(),
            route: format!("/x/{id}"),
            at,
            text: text.into(),
        }
    }

    /// Skips on a machine that cannot run Zvec, which is exactly the case the app falls back on.
    fn fresh_index() -> Option<(SearchIndex, PathBuf)> {
        if let Err(e) = engine() {
            eprintln!("skipping: {e}");
            return None;
        }
        let root = std::env::temp_dir().join(format!("lare-search-test-{}", uuid::Uuid::new_v4()));
        Some((SearchIndex::new(root.clone()), root))
    }

    /// Closes the collection first: Windows will not delete files it still has open.
    fn cleanup(index: SearchIndex, root: PathBuf) {
        drop(index);
        let _ = std::fs::remove_dir_all(root);
    }

    fn ids(hits: &[SearchHit]) -> Vec<&str> {
        let mut ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        ids.sort_unstable();
        ids
    }

    #[test]
    fn matches_parts_of_words_in_short_docs_and_whole_words_in_said() {
        let Some((index, root)) = fresh_index() else {
            return;
        };
        assert_eq!(index.open(USER).unwrap(), SyncState::default());
        let docs = [
            doc(
                "session:1",
                "session",
                "Valid Palindrome",
                1,
                "easy two pointers python3 accepted",
            ),
            doc(
                "session:2",
                "session",
                "Two Sum",
                2,
                "easy hash table java failed",
            ),
            doc(
                "said:transcript:1",
                "said",
                "Valid Palindrome",
                3,
                "I reached for a hashmap and then a sliding window",
            ),
        ];
        index.index(&docs, &[], &SyncState::default()).unwrap();

        assert_eq!(ids(&index.query("palin").unwrap()), ["session:1"]);
        assert_eq!(ids(&index.query("two sum").unwrap()), ["session:2"]);
        assert_eq!(ids(&index.query("PYTHON").unwrap()), ["session:1"]);
        // Said text is not cut into ngrams: a half word does not reach it, a whole one does.
        assert_eq!(ids(&index.query("hashm").unwrap()), Vec::<&str>::new());
        assert_eq!(ids(&index.query("hashmap").unwrap()), ["said:transcript:1"]);
        assert_eq!(ids(&index.query("windows").unwrap()), ["said:transcript:1"]);

        let hit = index
            .query("palindrome")
            .unwrap()
            .into_iter()
            .find(|h| h.id == "session:1")
            .unwrap();
        assert_eq!(
            (
                hit.kind.as_str(),
                hit.title.as_str(),
                hit.route.as_str(),
                hit.at
            ),
            ("session", "Valid Palindrome", "/x/session:1", 1)
        );
        cleanup(index, root);
    }

    #[test]
    fn replacing_a_kind_drops_docs_that_were_not_resent() {
        let Some((index, root)) = fresh_index() else {
            return;
        };
        index.open(USER).unwrap();
        let first = [
            doc("person:1", "person", "Ben", 0, "ben"),
            doc("person:2", "person", "Paul", 0, "paul"),
        ];
        index
            .index(&first, &["person".into()], &SyncState::default())
            .unwrap();
        index
            .index(&first[..1], &["person".into()], &SyncState::default())
            .unwrap();
        assert_eq!(ids(&index.query("ben").unwrap()), ["person:1"]);
        assert!(index.query("paul").unwrap().is_empty());
        cleanup(index, root);
    }

    #[test]
    fn keeps_docs_and_sync_state_across_reopening() {
        let Some((index, root)) = fresh_index() else {
            return;
        };
        index.open(USER).unwrap();
        let sync = SyncState {
            transcripts_since: Some("2026-10-30T00:00:00Z".into()),
            reviews_since: None,
        };
        index
            .index(
                &[doc("session:1", "session", "Merge Intervals", 1, "")],
                &[],
                &sync,
            )
            .unwrap();
        drop(index);

        let index = SearchIndex::new(root.clone());
        assert_eq!(index.open(USER).unwrap(), sync);
        assert_eq!(ids(&index.query("interval").unwrap()), ["session:1"]);
        cleanup(index, root);
    }

    #[test]
    fn tolerates_punctuation_and_short_queries() {
        let Some((index, root)) = fresh_index() else {
            return;
        };
        index.open(USER).unwrap();
        index
            .index(
                &[doc("session:1", "session", "Two Sum", 1, "")],
                &[],
                &SyncState::default(),
            )
            .unwrap();
        for text in [
            "", "t", "!!", "two-sum", "\"two", "(sum)", "two: sum", "AND", "-two",
        ] {
            assert!(index.query(text).is_ok(), "query {text:?} failed");
        }
        assert_eq!(ids(&index.query("two-sum").unwrap()), ["session:1"]);
        cleanup(index, root);
    }

    #[test]
    fn refuses_bad_ids_and_kinds() {
        let Some((index, root)) = fresh_index() else {
            return;
        };
        assert!(index.open("../../etc").is_err());
        index.open(USER).unwrap();
        let bad = doc("x:1", "secrets' OR kind = 'session", "x", 0, "");
        assert!(index.index(&[bad], &[], &SyncState::default()).is_err());
        cleanup(index, root);
    }
}
