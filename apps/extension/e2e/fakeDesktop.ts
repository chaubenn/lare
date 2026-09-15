/**
 * A stand-in for the Lare desktop app's local socket (`ws://127.0.0.1:47831`), just enough of
 * RFC 6455 for the extension's text frames: handshake, masked client frames in, unmasked frames
 * out. Tests script its replies through `onMessage`.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export type DesktopFrame = Record<string, unknown> & { type: string };

export class FakeDesktop {
  readonly received: DesktopFrame[] = [];
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  private handler: (msg: DesktopFrame, reply: (frame: object) => void) => void = () => {};

  constructor(
    private readonly ack: { userId: string | null; recordingCapable: boolean; protocol: number },
  ) {}

  onMessage(handler: (msg: DesktopFrame, reply: (frame: object) => void) => void): void {
    this.handler = handler;
  }

  async start(port = 47831): Promise<void> {
    const server = createServer((_req, res) => {
      res.writeHead(404).end();
    });
    server.on("upgrade", (req, socket: Socket) => {
      const key = req.headers["sec-websocket-key"];
      if (typeof key !== "string") return socket.destroy();
      const accept = createHash("sha1")
        .update(key + GUID)
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      this.sockets.add(socket);
      // The extension hangs up abruptly when it drops a handshake it cannot use.
      socket.on("error", () => this.sockets.delete(socket));
      socket.on("close", () => this.sockets.delete(socket));
      let buffer = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
          const frame = readFrame(buffer);
          if (!frame) break;
          buffer = buffer.subarray(frame.length);
          if (frame.opcode === 0x8) return socket.end();
          if (frame.opcode !== 0x1) continue;
          const msg = JSON.parse(frame.payload.toString("utf8")) as DesktopFrame;
          this.received.push(msg);
          const reply = (out: object) => socket.write(textFrame(JSON.stringify(out)));
          if (msg.type === "hello") {
            reply({
              type: "hello.ack",
              protocol: this.ack.protocol,
              appVersion: "0.0.0-e2e",
              userId: this.ack.userId,
              recordingCapable: this.ack.recordingCapable,
            });
          } else if (msg.type === "ping") {
            reply({ type: "pong", at: msg.at });
          } else {
            this.handler(msg, reply);
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = null;
  }
}

function readFrame(buf: Buffer): { opcode: number; payload: Buffer; length: number } | null {
  if (buf.length < 2) return null;
  const opcode = (buf[0] ?? 0) & 0x0f;
  const masked = ((buf[1] ?? 0) & 0x80) !== 0;
  let len = (buf[1] ?? 0) & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  const maskLength = masked ? 4 : 0;
  if (buf.length < offset + maskLength + len) return null;
  const mask = buf.subarray(offset, offset + maskLength);
  const payload = Buffer.from(buf.subarray(offset + maskLength, offset + maskLength + len));
  if (masked)
    for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
  return { opcode, payload, length: offset + maskLength + len };
}

function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}
