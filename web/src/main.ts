import "./style.css";

type ConnectionState = "disconnected" | "connecting" | "connected";

interface CursorPacket {
  type: "cursor";
  version: 1;
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

interface LeavePacket {
  type: "leave";
  version: 1;
  id: string;
}

interface RemoteCursor {
  element: HTMLDivElement;
  lastSeenAt: number;
}

const get = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
};

const connectionForm = get<HTMLFormElement>("connection-form");
const addressInput = get<HTMLInputElement>("server-address");
const roomInput = get<HTMLInputElement>("room-name");
const connectButton = get<HTMLButtonElement>("connect-button");
const connectLabel = get<HTMLSpanElement>("connect-label");
const statusDot = get<HTMLSpanElement>("status-dot");
const statusText = get<HTMLSpanElement>("status-text");
const stage = get<HTMLDivElement>("cursor-stage");
const stageNotice = get<HTMLDivElement>("stage-notice");
const cursorLayer = get<HTMLDivElement>("cursor-layer");
const localCursor = get<HTMLDivElement>("local-cursor");
const localName = get<HTMLSpanElement>("local-name");
const participantCount = get<HTMLSpanElement>("participant-count");
const connectionNote = get<HTMLParagraphElement>("connection-note");
const identitySwatch = get<HTMLSpanElement>("identity-swatch");
const identityLabel = get<HTMLSpanElement>("identity-label");

const palette = ["#c9ff4a", "#70d6ff", "#ff70a6", "#ffca3a", "#b892ff", "#ff8c42"];
const sessionId = sessionStorage.getItem("room-relay-id") ?? crypto.randomUUID();
sessionStorage.setItem("room-relay-id", sessionId);
const identity = {
  id: sessionId,
  name: `Guest ${sessionId.slice(0, 4).toUpperCase()}`,
  color: palette[hashString(sessionId) % palette.length]!,
};

const defaultProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const defaultHostname = window.location.hostname === "localhost" ? "127.0.0.1" : window.location.hostname;
const defaultPort = window.location.port === "5173" ? "8080" : window.location.port;
const defaultHost = defaultPort ? `${defaultHostname}:${defaultPort}` : defaultHostname;
addressInput.value = `${defaultProtocol}//${defaultHost || "localhost:8080"}/ws`;
localName.textContent = `${identity.name} · you`;
localCursor.style.setProperty("--cursor-color", identity.color);
identitySwatch.style.background = identity.color;
identityLabel.textContent = `${identity.name} · this tab`;

let socket: WebSocket | null = null;
let reconnectToken = 0;
let queuedFrame = 0;
let latestPosition = { x: 0.5, y: 0.5 };
const remoteCursors = new Map<string, RemoteCursor>();

function hashString(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function setState(state: ConnectionState, detail?: string): void {
  document.body.dataset.connection = state;
  statusDot.dataset.state = state;
  statusText.textContent = detail ?? state[0]!.toUpperCase() + state.slice(1);
  const connected = state === "connected";
  const connecting = state === "connecting";
  connectLabel.textContent = connected ? "Disconnect" : connecting ? "Connecting…" : "Connect";
  connectButton.disabled = connecting;
  addressInput.disabled = connected || connecting;
  roomInput.disabled = connected || connecting;
  stage.classList.toggle("is-live", connected);
  stageNotice.hidden = connected;
  connectionNote.textContent = connected
    ? "Move inside the canvas. Other people in this room will see your cursor."
    : "Connect, then open this page in another tab using the same room.";
  updateParticipantCount();
}

function normalizedAddress(rawAddress: string, room: string): string {
  const withProtocol = /^wss?:\/\//i.test(rawAddress)
    ? rawAddress
    : `${defaultProtocol}//${rawAddress}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Use a ws:// or wss:// server address");
  }
  if (url.pathname === "/") url.pathname = "/ws";
  url.searchParams.set("room", room);
  return url.toString();
}

function updateParticipantCount(): void {
  const total = remoteCursors.size + (socket?.readyState === WebSocket.OPEN ? 1 : 0);
  participantCount.textContent = `${total} ${total === 1 ? "cursor" : "cursors"} online`;
}

function packetForPosition(): CursorPacket {
  return { type: "cursor", version: 1, ...identity, ...latestPosition };
}

function send(packet: CursorPacket | LeavePacket): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(packet));
}

function removeRemoteCursor(id: string): void {
  const cursor = remoteCursors.get(id);
  if (!cursor) return;
  cursor.element.remove();
  remoteCursors.delete(id);
  updateParticipantCount();
}

function renderRemoteCursor(packet: CursorPacket): void {
  if (packet.id === identity.id) return;
  let remote = remoteCursors.get(packet.id);
  if (!remote) {
    if (remoteCursors.size >= 64) return;
    const element = document.createElement("div");
    element.className = "demo-cursor remote-cursor";
    element.dataset.cursorId = packet.id;
    element.innerHTML = '<svg viewBox="0 0 24 30" aria-hidden="true"><path d="M2 2v23l6.8-6.4 4.4 9.4 4-1.9-4.5-9.1H22L2 2Z"/></svg><span></span>';
    cursorLayer.append(element);
    remote = { element, lastSeenAt: Date.now() };
    remoteCursors.set(packet.id, remote);
  }

  remote.lastSeenAt = Date.now();
  remote.element.style.setProperty("--cursor-x", String(packet.x));
  remote.element.style.setProperty("--cursor-y", String(packet.y));
  remote.element.style.setProperty("--cursor-color", packet.color);
  const label = remote.element.querySelector("span");
  if (label) label.textContent = packet.name;
  updateParticipantCount();
}

function isCursorPacket(value: unknown): value is CursorPacket {
  if (!value || typeof value !== "object") return false;
  const packet = value as Partial<CursorPacket>;
  return packet.type === "cursor" &&
    packet.version === 1 &&
    typeof packet.id === "string" && packet.id.length > 0 && packet.id.length <= 64 &&
    typeof packet.name === "string" && packet.name.length > 0 && packet.name.length <= 24 &&
    typeof packet.color === "string" && /^#[\da-f]{6}$/i.test(packet.color) &&
    typeof packet.x === "number" && Number.isFinite(packet.x) && packet.x >= 0 && packet.x <= 1 &&
    typeof packet.y === "number" && Number.isFinite(packet.y) && packet.y >= 0 && packet.y <= 1;
}

function isLeavePacket(value: unknown): value is LeavePacket {
  if (!value || typeof value !== "object") return false;
  const packet = value as Partial<LeavePacket>;
  return packet.type === "leave" && packet.version === 1 &&
    typeof packet.id === "string" && packet.id.length > 0 && packet.id.length <= 64;
}

function clearRemoteCursors(): void {
  for (const cursor of remoteCursors.values()) cursor.element.remove();
  remoteCursors.clear();
  updateParticipantCount();
}

function disconnect(): void {
  reconnectToken += 1;
  const activeSocket = socket;
  if (activeSocket?.readyState === WebSocket.OPEN) {
    activeSocket.send(JSON.stringify({ type: "leave", version: 1, id: identity.id } satisfies LeavePacket));
  }
  socket = null;
  activeSocket?.close(1000, "Disconnected by user");
  localCursor.hidden = true;
  clearRemoteCursors();
  setState("disconnected");
}

function connect(): void {
  let url: string;
  try {
    url = normalizedAddress(addressInput.value.trim(), roomInput.value.trim());
  } catch (error) {
    connectionNote.textContent = error instanceof Error ? error.message : "Invalid server address";
    return;
  }

  const token = ++reconnectToken;
  setState("connecting");
  const nextSocket = new WebSocket(url);
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    if (token !== reconnectToken) return;
    setState("connected", `Live · ${roomInput.value.trim()}`);
    send(packetForPosition());
  });

  nextSocket.addEventListener("message", async (event) => {
    try {
      const content = typeof event.data === "string" ? event.data : await event.data.text();
      const packet: unknown = JSON.parse(content);
      if (isCursorPacket(packet)) renderRemoteCursor(packet);
      else if (isLeavePacket(packet)) removeRemoteCursor(packet.id);
    } catch {
      // The relay is content-agnostic; this demo ignores packets it does not understand.
    }
  });

  nextSocket.addEventListener("error", () => {
    if (token === reconnectToken) connectionNote.textContent = "Connection error. Check the server address.";
  });

  nextSocket.addEventListener("close", (event) => {
    if (token !== reconnectToken) return;
    socket = null;
    localCursor.hidden = true;
    clearRemoteCursors();
    setState("disconnected", event.wasClean ? "Disconnected" : "Connection lost");
    if (!event.wasClean) {
      connectionNote.textContent = `Connection closed (${event.code}${event.reason ? `: ${event.reason}` : ""}).`;
    }
  });
}

connectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (socket?.readyState === WebSocket.OPEN) disconnect();
  else connect();
});

stage.addEventListener("pointermove", (event) => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const bounds = stage.getBoundingClientRect();
  latestPosition = {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  };
  localCursor.hidden = false;
  localCursor.style.setProperty("--cursor-x", String(latestPosition.x));
  localCursor.style.setProperty("--cursor-y", String(latestPosition.y));

  if (!queuedFrame) {
    queuedFrame = requestAnimationFrame(() => {
      queuedFrame = 0;
      send(packetForPosition());
    });
  }
});

stage.addEventListener("pointerleave", () => {
  localCursor.hidden = true;
});

setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) send(packetForPosition());
  const staleBefore = Date.now() - 10_000;
  for (const [id, cursor] of remoteCursors) {
    if (cursor.lastSeenAt < staleBefore) removeRemoteCursor(id);
  }
}, 3_000);

window.addEventListener("beforeunload", () => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "leave", version: 1, id: identity.id } satisfies LeavePacket));
    socket.close(1000);
  }
});

setState("disconnected");
