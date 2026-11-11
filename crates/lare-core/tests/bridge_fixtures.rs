//! The Rust half of the bridge contract. `packages/shared/fixtures/bridge.json` is the one
//! description of the extension <-> desktop protocol both sides are tested against; the
//! TypeScript half is `packages/shared/src/session/protocol.test.ts`.

use lare_core::protocol::{AppToExt, ExtToApp};
use lare_core::{
    AUTH_CALLBACK_PATH, MIN_EXT_PROTOCOL_VERSION, PAIRING_DOMAIN, PROTOCOL_VERSION, WS_PORT,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../packages/shared/fixtures/bridge.json"
    ))
    .expect("bridge.json is valid JSON")
}

fn frames(fixture: &Value, direction: &str) -> Vec<Value> {
    let frames = fixture[direction]
        .as_array()
        .unwrap_or_else(|| panic!("bridge.json has no `{direction}` array"));
    assert!(!frames.is_empty(), "`{direction}` lists no frames");
    frames.clone()
}

/// Every frame parses, and serialising it again gives back exactly the fixture: no field is
/// dropped, renamed or added on the Rust side.
fn assert_round_trips<T: DeserializeOwned + Serialize>(direction: &str) {
    for frame in frames(&fixture(), direction) {
        let parsed: T = serde_json::from_value(frame.clone())
            .unwrap_or_else(|e| panic!("{direction} frame does not parse: {e}\n{frame}"));
        let back = serde_json::to_value(&parsed).expect("frame serialises");
        assert_eq!(back, frame, "{direction} frame changed on the way through");
    }
}

#[test]
fn constants_match_the_shared_fixture() {
    let constants = &fixture()["constants"];
    assert_eq!(
        json!({
            "wsPort": WS_PORT,
            "authCallbackPath": AUTH_CALLBACK_PATH,
            "protocolVersion": PROTOCOL_VERSION,
            "minExtProtocolVersion": MIN_EXT_PROTOCOL_VERSION,
            "pairingDomain": PAIRING_DOMAIN,
        }),
        json!({
            "wsPort": constants["wsPort"],
            "authCallbackPath": constants["authCallbackPath"],
            "protocolVersion": constants["protocolVersion"],
            "minExtProtocolVersion": constants["minExtProtocolVersion"],
            "pairingDomain": constants["pairingDomain"],
        })
    );
}

#[test]
fn extension_frames_round_trip() {
    assert_round_trips::<ExtToApp>("extToApp");
}

#[test]
fn app_frames_round_trip() {
    assert_round_trips::<AppToExt>("appToExt");
}
