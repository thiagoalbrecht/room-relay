import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import WebSocket, { type RawData } from "ws";
import { createRealtimeServer, type RealtimeServer } from "../src/server.js";

let server: RealtimeServer;
let baseUrl: string;
const clients: WebSocket[] = [];

beforeEach(async () => {
  server = createRealtimeServer({ serveFrontend: false });
  const address = await server.start(0, "127.0.0.1");
  baseUrl = `ws://127.0.0.1:${address.port}/ws`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await server.stop();
});

function connect(room: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`${baseUrl}?room=${encodeURIComponent(room)}`);
    clients.push(client);
    client.once("open", () => resolve(client));
    client.once("error", reject);
  });
}

function nextMessage(client: WebSocket, timeoutMs = 500): Promise<RawData> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for a message")), timeoutMs);
    client.once("message", (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}

function expectSilence(client: WebSocket, timeoutMs = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off("message", onMessage);
      resolve();
    }, timeoutMs);
    const onMessage = () => {
      clearTimeout(timeout);
      reject(new Error("Unexpected message received"));
    };
    client.once("message", onMessage);
  });
}

function asBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

test("relays text to other clients in the same room without echoing", async () => {
  const sender = await connect("game-1");
  const receiver = await connect("game-1");
  const received = nextMessage(receiver);

  sender.send('{"move":"north"}');

  assert.equal((await received).toString(), '{"move":"north"}');
  await expectSilence(sender);
  assert.equal(server.rooms.connectionCount, 2);
  assert.equal(server.rooms.roomCount, 1);
});

test("isolates clients in different rooms", async () => {
  const sender = await connect("room-a");
  const otherRoom = await connect("room-b");

  sender.send("private-to-room-a");

  await expectSilence(otherRoom);
  assert.equal(server.rooms.roomCount, 2);
});

test("relays binary payloads unchanged", async () => {
  const sender = await connect("binary");
  const receiver = await connect("binary");
  const received = nextMessage(receiver);
  const payload = Buffer.from([0, 1, 2, 250, 255]);

  sender.send(payload);

  assert.deepEqual(asBuffer(await received), payload);
});

test("rejects connections without a valid room", async () => {
  await assert.rejects(
    () => connect("space is invalid"),
    /Unexpected server response: 400/,
  );
  assert.equal(server.rooms.connectionCount, 0);
});
