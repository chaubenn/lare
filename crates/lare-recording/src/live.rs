use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, anyhow};

use crate::fragmented::Muxer;

pub struct Fragment {
    pub track: usize,
    pub path: PathBuf,
    pub index: u32,
    pub is_init: bool,
}

pub struct LiveOutput {
    pub path: PathBuf,
    state: Arc<AtomicU8>,
    finished: tokio::sync::watch::Sender<bool>,
    task: Option<tokio::task::JoinHandle<anyhow::Result<()>>>,
}

impl LiveOutput {
    pub fn start(
        project: &Path,
        audio: bool,
        mut receive: impl FnMut(Duration) -> Result<Fragment, std::sync::mpsc::RecvTimeoutError>
        + Send
        + 'static,
    ) -> anyhow::Result<Self> {
        let path = project.join("content/capture.mp4");
        let file = File::create(&path).context("creating append-only capture output")?;
        let state = Arc::new(AtomicU8::new(0));
        let worker_state = state.clone();
        let (finished, _) = tokio::sync::watch::channel(false);
        let task = tokio::task::spawn_blocking(move || {
            let mut file = Some(file);
            let mut muxer = None;
            let mut inits: Vec<Option<Vec<u8>>> = vec![None; if audio { 2 } else { 1 }];
            let mut pending = Vec::new();
            let mut next = vec![1u32; inits.len()];
            loop {
                if worker_state.load(Ordering::Acquire) == 2 {
                    return Err(anyhow!("capture producer aborted"));
                }
                let event = match receive(Duration::from_millis(100)) {
                    Ok(event) => event,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout)
                        if worker_state.load(Ordering::Acquire) == 0 =>
                    {
                        continue;
                    }
                    Err(_) => break,
                };
                let track = event.track;
                if track >= inits.len() {
                    return Err(anyhow!("unexpected audio fragment"));
                }
                if event.is_init {
                    if inits[track].is_some() {
                        return Err(anyhow!("duplicate init segment"));
                    }
                    inits[track] = Some(std::fs::read(event.path)?);
                } else {
                    if event.index != next[track] {
                        return Err(anyhow!("missing/out-of-order media fragment"));
                    }
                    next[track] += 1;
                    pending.push((track, event.path));
                }
                if muxer.is_none() && inits.iter().all(Option::is_some) {
                    let headers = inits
                        .iter()
                        .map(|v| v.as_ref().unwrap().clone())
                        .collect::<Vec<_>>();
                    muxer = Some(Muxer::new(file.take().unwrap(), &headers)?);
                }
                if let Some(muxer) = &mut muxer {
                    for (track, path) in pending.drain(..) {
                        muxer.append(track, &std::fs::read(path)?)?;
                    }
                }
            }
            let file = muxer
                .ok_or_else(|| anyhow!("capture ended before track initialization"))?
                .finish()?;
            file.sync_all()?;
            drop(file);
            Ok(())
        });
        Ok(Self {
            path,
            state,
            finished,
            task: Some(task),
        })
    }

    pub fn completion(&self) -> tokio::sync::watch::Receiver<bool> {
        self.finished.subscribe()
    }

    pub async fn finish(mut self, clean: bool) -> anyhow::Result<PathBuf> {
        self.state
            .store(if clean { 1 } else { 2 }, Ordering::Release);
        self.task
            .take()
            .unwrap()
            .await
            .context("live muxer task panicked")??;
        if !clean {
            return Err(anyhow!("capture did not stop cleanly"));
        }
        // Recovery must never mistake a partially written capture file for a finished take.
        std::fs::write(self.path.with_extension("complete"), b"closed")?;
        self.finished.send_replace(true);
        Ok(self.path.clone())
    }
}

impl Drop for LiveOutput {
    fn drop(&mut self) {
        self.state.store(2, Ordering::Release);
    }
}
