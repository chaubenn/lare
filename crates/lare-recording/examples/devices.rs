//! Smoke test: `cargo run -p lare-recording --example devices`
//! Lists capture devices and permission state (links the whole Cap stack).
fn main() {
    let perms = lare_recording::permissions::check();
    println!("permissions: {perms:?} (recording_capable={})", perms.recording_capable());
    for d in lare_recording::devices::list_displays() {
        println!("display: {} [{}] {}x{} @{:.0}Hz primary={}", d.name, d.id, d.width, d.height, d.refresh_rate, d.primary);
    }
    for c in lare_recording::devices::list_cameras() {
        println!("camera: {} [{}]", c.name, c.id);
    }
    for m in lare_recording::devices::list_microphones() {
        println!("microphone: {} default={}", m.name, m.default);
    }
}
