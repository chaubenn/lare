//! Small ISO BMFF remuxer for Cap's closed, single-track DASH fragments.
//! No decoding, seeking, or rewriting output bytes. Keep this module std-only so
//! its format and append-only invariants can be tested without native FFmpeg.

use std::io::{self, Write};

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn boxes(bytes: &[u8]) -> io::Result<Vec<([u8; 4], &[u8])>> {
    let mut result = Vec::new();
    let mut rest = bytes;
    while !rest.is_empty() {
        if rest.len() < 8 {
            return Err(invalid("truncated box header"));
        }
        let size = u32::from_be_bytes(rest[..4].try_into().unwrap()) as usize;
        // Cap's small init/moof boxes and bounded media fragments use 32-bit sizes.
        // Reject unbounded/extended boxes rather than guessing their layout.
        if size < 8 || size > rest.len() {
            return Err(invalid("unsupported or truncated box size"));
        }
        result.push((rest[4..8].try_into().unwrap(), &rest[8..size]));
        rest = &rest[size..];
    }
    Ok(result)
}

fn boxed(kind: &[u8; 4], payload: &[u8]) -> io::Result<Vec<u8>> {
    let size = u32::try_from(payload.len() + 8).map_err(|_| invalid("box too large"))?;
    let mut out = size.to_be_bytes().to_vec();
    out.extend_from_slice(kind);
    out.extend_from_slice(payload);
    Ok(out)
}

fn field(bytes: &mut [u8], offset: usize, value: u32) -> io::Result<()> {
    bytes
        .get_mut(offset..offset + 4)
        .ok_or_else(|| invalid("truncated field"))?
        .copy_from_slice(&value.to_be_bytes());
    Ok(())
}

fn track_id(bytes: &[u8]) -> io::Result<(usize, u32)> {
    let offset = match bytes.first() {
        Some(0) => 12,
        Some(1) => 20,
        _ => return Err(invalid("unsupported tkhd version")),
    };
    let id = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| invalid("truncated tkhd"))?;
    Ok((offset, u32::from_be_bytes(id.try_into().unwrap())))
}

pub struct Muxer<W> {
    output: W,
    source_ids: Vec<u32>,
    sequence: u32,
    fragments: Vec<u32>,
}

impl<W: Write> Muxer<W> {
    /// Video first, optional audio second. Each init must describe exactly one track.
    pub fn new(mut output: W, inits: &[Vec<u8>]) -> io::Result<Self> {
        if inits.is_empty() || inits.len() > 2 {
            return Err(invalid("expected video and optional audio init"));
        }
        let mut movie = Vec::new();
        let mut tracks = Vec::new();
        let mut defaults = Vec::new();
        let mut source_ids = Vec::new();
        let mut movie_timescale = None;
        for (index, init) in inits.iter().enumerate() {
            let top = boxes(init)?;
            let moovs: Vec<_> = top.iter().filter(|(k, _)| k == b"moov").collect();
            if moovs.len() != 1 {
                return Err(invalid("expected one moov"));
            }
            let children = boxes(moovs[0].1)?;
            let traks: Vec<_> = children.iter().filter(|(k, _)| k == b"trak").collect();
            if traks.len() != 1 {
                return Err(invalid("expected single-track DASH init"));
            }
            let mut track = Vec::new();
            let mut source_id = None;
            for (kind, data) in boxes(traks[0].1)? {
                let mut data = data.to_vec();
                if &kind == b"tkhd" {
                    let (offset, id) = track_id(&data)?;
                    source_id = Some(id);
                    field(&mut data, offset, index as u32 + 1)?;
                }
                track.extend(boxed(&kind, &data)?);
            }
            let source_id = source_id.ok_or_else(|| invalid("missing tkhd"))?;
            source_ids.push(source_id);
            tracks.extend(boxed(b"trak", &track)?);
            let mut found_defaults = false;
            let mut found_header = false;
            for (kind, data) in children {
                if &kind == b"mvhd" {
                    found_header = true;
                    let offset = match data.first() {
                        Some(0) => 12,
                        Some(1) => 20,
                        _ => return Err(invalid("unsupported mvhd version")),
                    };
                    let scale = data
                        .get(offset..offset + 4)
                        .ok_or_else(|| invalid("truncated mvhd"))?;
                    let scale = u32::from_be_bytes(scale.try_into().unwrap());
                    if scale == 0 || movie_timescale.is_some_and(|previous| previous != scale) {
                        return Err(invalid(
                            "incompatible movie timescales for track edit lists",
                        ));
                    }
                    movie_timescale = Some(scale);
                    if index == 0 {
                        let mut header = data.to_vec();
                        let len = header.len();
                        if len < 4 {
                            return Err(invalid("truncated mvhd"));
                        }
                        field(&mut header, len - 4, inits.len() as u32 + 1)?;
                        movie.extend(boxed(b"mvhd", &header)?);
                    }
                } else if &kind == b"mvex" {
                    for (kind, data) in boxes(data)? {
                        if &kind == b"trex" {
                            if found_defaults
                                || data.len() < 24
                                || data[4..8] != source_id.to_be_bytes()
                            {
                                return Err(invalid("invalid trex track"));
                            }
                            found_defaults = true;
                            let mut data = data.to_vec();
                            field(&mut data, 4, index as u32 + 1)?;
                            defaults.extend(boxed(b"trex", &data)?);
                        }
                    }
                }
            }
            if !found_header || !found_defaults {
                return Err(invalid("missing movie header or defaults"));
            }
        }
        movie.extend(tracks);
        movie.extend(boxed(b"mvex", &defaults)?);
        // Generic fragmented ISO MP4, not a single-track DASH representation.
        output.write_all(&boxed(b"ftyp", b"iso6\0\0\0\x01iso6isommp41")?)?;
        output.write_all(&boxed(b"moov", &movie)?)?;
        output.flush()?;
        Ok(Self {
            output,
            fragments: vec![0; source_ids.len()],
            source_ids,
            sequence: 0,
        })
    }

    pub fn append(&mut self, track: usize, bytes: &[u8]) -> io::Result<()> {
        let source = *self
            .source_ids
            .get(track)
            .ok_or_else(|| invalid("unknown track"))?;
        let mut fragment = Vec::new();
        let mut pending_moof = false;
        let mut count = 0;
        for (kind, data) in boxes(bytes)? {
            match &kind {
                b"styp" | b"sidx" => {} // Their single-track indexes no longer describe this file.
                b"moof" => {
                    if pending_moof {
                        return Err(invalid("moof without mdat"));
                    }
                    pending_moof = true;
                    self.sequence = self
                        .sequence
                        .checked_add(1)
                        .ok_or_else(|| invalid("sequence overflow"))?;
                    let mut moof = Vec::new();
                    let mut traf_count = 0;
                    let mut mfhd_count = 0;
                    for (kind, data) in boxes(data)? {
                        let mut payload = data.to_vec();
                        if &kind == b"mfhd" {
                            mfhd_count += 1;
                            field(&mut payload, 4, self.sequence)?;
                        } else if &kind == b"traf" {
                            traf_count += 1;
                            payload.clear();
                            let mut has_header = false;
                            let mut has_time = false;
                            let mut has_run = false;
                            for (kind, data) in boxes(data)? {
                                let mut data = data.to_vec();
                                if &kind == b"tfhd" {
                                    if has_header || data.len() < 8 {
                                        return Err(invalid("invalid tfhd"));
                                    }
                                    has_header = true;
                                    let flags = u32::from_be_bytes(data[..4].try_into().unwrap())
                                        & 0xffffff;
                                    // Offsets must be moof-relative; otherwise moving the fragment
                                    // would point samples at another track's data.
                                    if flags & 1 != 0
                                        || flags & 0x020000 == 0
                                        || data[4..8] != source.to_be_bytes()
                                    {
                                        return Err(invalid(
                                            "fragment is not track-local/moof-relative",
                                        ));
                                    }
                                    field(&mut data, 4, track as u32 + 1)?;
                                } else if &kind == b"tfdt" {
                                    has_time = true;
                                } else if &kind == b"trun" {
                                    has_run = true;
                                } else if &kind == b"saio" {
                                    return Err(invalid("encrypted/auxiliary offsets unsupported"));
                                }
                                payload.extend(boxed(&kind, &data)?);
                            }
                            if !has_header || !has_time || !has_run {
                                return Err(invalid("incomplete traf"));
                            }
                        }
                        moof.extend(boxed(&kind, &payload)?);
                    }
                    if traf_count != 1 || mfhd_count != 1 {
                        return Err(invalid("expected one traf and mfhd"));
                    }
                    fragment.extend(boxed(b"moof", &moof)?);
                }
                b"mdat" => {
                    if !pending_moof {
                        return Err(invalid("mdat without moof"));
                    }
                    pending_moof = false;
                    count += 1;
                    fragment.extend(boxed(b"mdat", data)?);
                }
                _ => return Err(invalid("unsupported media box")),
            }
        }
        if pending_moof || count == 0 {
            return Err(invalid("incomplete media fragment"));
        }
        self.output.write_all(&fragment)?;
        self.output.flush()?;
        self.fragments[track] += count;
        Ok(())
    }

    pub fn finish(mut self) -> io::Result<W> {
        if self.fragments.contains(&0) {
            return Err(invalid("track produced no media"));
        }
        self.output.flush()?;
        Ok(self.output)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn init(id: u32, audio: bool) -> Vec<u8> {
        let mut mvhd = vec![0; 100];
        field(&mut mvhd, 12, 1000).unwrap();
        let mut tkhd = vec![0; 84];
        field(&mut tkhd, 12, id).unwrap();
        let mut trex = vec![0; 24];
        field(&mut trex, 4, id).unwrap();
        field(&mut trex, 8, 1).unwrap();
        let mut trak = boxed(b"tkhd", &tkhd).unwrap();
        // Distinct opaque sample-description payloads must survive unchanged.
        trak.extend(
            boxed(
                b"mdia",
                if audio {
                    b"aac-description"
                } else {
                    b"h264-description"
                },
            )
            .unwrap(),
        );
        let mut moov = boxed(b"mvhd", &mvhd).unwrap();
        moov.extend(boxed(b"trak", &trak).unwrap());
        moov.extend(boxed(b"mvex", &boxed(b"trex", &trex).unwrap()).unwrap());
        boxed(b"moov", &moov).unwrap()
    }

    pub(crate) fn fragment(id: u32, time: u64, data: &[u8], flags: u32) -> Vec<u8> {
        let mut tfhd = flags.to_be_bytes().to_vec();
        tfhd.extend(id.to_be_bytes());
        let mut tfdt = vec![1, 0, 0, 0];
        tfdt.extend(time.to_be_bytes());
        let mut trun = vec![0, 0, 3, 1]; // data-offset, sample duration and size
        trun.extend(1u32.to_be_bytes());
        trun.extend(0u32.to_be_bytes());
        trun.extend(1024u32.to_be_bytes());
        trun.extend((data.len() as u32).to_be_bytes());
        let mut traf = boxed(b"tfhd", &tfhd).unwrap();
        traf.extend(boxed(b"tfdt", &tfdt).unwrap());
        let offset = 8 + 16 + 8 + traf.len() + 8 + trun.len() + 8;
        field(&mut trun, 8, offset as u32).unwrap();
        traf.extend(boxed(b"trun", &trun).unwrap());
        let mut moof = boxed(b"mfhd", &[0; 8]).unwrap();
        moof.extend(boxed(b"traf", &traf).unwrap());
        let mut result = boxed(b"styp", b"msdh\0\0\0\0msdhmsix").unwrap();
        result.extend(boxed(b"sidx", &[0; 40]).unwrap());
        result.extend(boxed(b"moof", &moof).unwrap());
        result.extend(boxed(b"mdat", data).unwrap());
        result
    }

    #[test]
    fn combines_tracks_and_appends_without_rewriting_prefix_or_timestamps() {
        let mut mux = Muxer::new(Vec::new(), &[init(1, false), init(1, true)]).unwrap();
        let header = mux.output.clone();
        mux.append(0, &fragment(1, 90000, b"video", 0x20000))
            .unwrap();
        let first = mux.output.clone();
        mux.append(1, &fragment(1, 48000, b"audio", 0x20000))
            .unwrap();
        let output = mux.finish().unwrap();
        assert!(output.starts_with(&first));
        assert!(first.starts_with(&header));
        let top = boxes(&output).unwrap();
        let movie = boxes(top[1].1).unwrap();
        let ids: Vec<_> = movie
            .iter()
            .filter(|(k, _)| k == b"trak")
            .map(|(_, data)| track_id(boxes(data).unwrap()[0].1).unwrap().1)
            .collect();
        assert_eq!(ids, [1, 2]);
        let defaults = boxes(movie.iter().find(|(k, _)| k == b"mvex").unwrap().1).unwrap();
        assert_eq!(&defaults[0].1[4..8], &1u32.to_be_bytes());
        assert_eq!(&defaults[1].1[4..8], &2u32.to_be_bytes());
        for (index, (kind, moof)) in top.iter().filter(|(k, _)| k == b"moof").enumerate() {
            assert_eq!(kind, b"moof");
            let children = boxes(moof).unwrap();
            assert_eq!(&children[0].1[4..8], &(index as u32 + 1).to_be_bytes());
            let traf = boxes(children[1].1).unwrap();
            assert_eq!(&traf[0].1[4..8], &(index as u32 + 1).to_be_bytes());
            assert_eq!(&traf[1].1[4..12], &[90000u64, 48000][index].to_be_bytes());
            let offset = u32::from_be_bytes(traf[2].1[8..12].try_into().unwrap()) as usize;
            assert_eq!(offset, moof.len() + 16); // start of adjacent mdat payload
        }
        assert_eq!(
            top.iter()
                .filter(|(k, _)| k == b"mdat")
                .map(|(_, d)| *d)
                .collect::<Vec<_>>(),
            [b"video", b"audio"]
        );
        assert!(!top.iter().any(|(k, _)| k == b"sidx" || k == b"styp"));
    }

    #[test]
    fn silent_capture_and_multiple_fragments() {
        let mut mux = Muxer::new(Vec::new(), &[init(7, false)]).unwrap();
        for time in [0, 3000, 6000] {
            mux.append(0, &fragment(7, time, b"frame", 0x20000))
                .unwrap();
        }
        assert_eq!(boxes(&mux.finish().unwrap()).unwrap().len(), 8);
    }

    #[test]
    fn rejects_absolute_offsets_and_wrong_tracks_without_appending() {
        for (id, flags) in [(1, 1), (1, 0), (8, 0x20000)] {
            let mut mux = Muxer::new(Vec::new(), &[init(1, false)]).unwrap();
            let before = mux.output.clone();
            assert!(mux.append(0, &fragment(id, 0, b"frame", flags)).is_err());
            assert_eq!(mux.output, before);
        }
    }

    #[test]
    fn rejects_truncated_fragments_and_unbounded_boxes() {
        let valid = fragment(1, 0, b"frame", 0x20000);
        for end in 0..valid.len() {
            let mut mux = Muxer::new(Vec::new(), &[init(1, false)]).unwrap();
            assert!(mux.append(0, &valid[..end]).is_err());
        }
        assert!(boxes(b"\0\0\0\0mdat").is_err());
        assert!(boxes(b"\0\0\0\x01mdat").is_err());
    }

    #[test]
    fn cannot_complete_missing_audio_or_video() {
        let mux = Muxer::new(Vec::new(), &[init(1, false)]).unwrap();
        assert!(mux.finish().is_err());
        let mut mux = Muxer::new(Vec::new(), &[init(1, false), init(1, true)]).unwrap();
        mux.append(0, &fragment(1, 0, b"frame", 0x20000)).unwrap();
        assert!(mux.finish().is_err());
    }
}
