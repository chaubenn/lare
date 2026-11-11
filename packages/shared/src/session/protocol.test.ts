import { describe, expect, it } from "vitest";
import bridge from "../../fixtures/bridge.json";
import {
  AUTH_CALLBACK_PATH,
  EXTENSION_ID,
  MIN_DESKTOP_PROTOCOL_VERSION,
  PAIRING_DOMAIN,
  PROTOCOL_VERSION,
  WS_PORT,
} from "./constants";
import { AppToExtSchema, ExtToAppSchema, pairingTranscript } from "./protocol";

// fixtures/bridge.json is the one description of the bridge both sides are tested against:
// crates/lare-core/tests/bridge_fixtures.rs holds the Rust half.
describe("bridge contract (fixtures/bridge.json)", () => {
  it("shares its constants with the desktop app", () => {
    expect({
      wsPort: WS_PORT,
      authCallbackPath: AUTH_CALLBACK_PATH,
      protocolVersion: PROTOCOL_VERSION,
      minDesktopProtocolVersion: MIN_DESKTOP_PROTOCOL_VERSION,
      pairingDomain: PAIRING_DOMAIN,
      extensionId: EXTENSION_ID,
    }).toEqual({
      wsPort: bridge.constants.wsPort,
      authCallbackPath: bridge.constants.authCallbackPath,
      protocolVersion: bridge.constants.protocolVersion,
      minDesktopProtocolVersion: bridge.constants.minDesktopProtocolVersion,
      pairingDomain: bridge.constants.pairingDomain,
      extensionId: bridge.constants.extensionId,
    });
  });

  it("signs the same pairing transcript as the desktop app", () => {
    const { role, userId, extNonce, appNonce, expected } = bridge.pairingTranscript;
    expect(pairingTranscript(role as "app" | "ext", userId, extNonce, appNonce)).toBe(expected);
  });

  it.each(bridge.extToApp.map((frame) => [frame.type, frame] as const))(
    "extension -> app %s has no field the schema drops or lacks",
    (_type, frame) => {
      expect(ExtToAppSchema.parse(frame)).toEqual(frame);
    },
  );

  it.each(bridge.appToExt.map((frame) => [frame.type, frame] as const))(
    "app -> extension %s has no field the schema drops or lacks",
    (_type, frame) => {
      expect(AppToExtSchema.parse(frame)).toEqual(frame);
    },
  );

  it("has a fixture for every frame type", () => {
    const types = (schema: typeof ExtToAppSchema | typeof AppToExtSchema) =>
      schema.options.map((option) => option.shape.type.value).sort();
    expect([...new Set(bridge.extToApp.map((f) => f.type))].sort()).toEqual(types(ExtToAppSchema));
    expect([...new Set(bridge.appToExt.map((f) => f.type))].sort()).toEqual(types(AppToExtSchema));
  });
});
