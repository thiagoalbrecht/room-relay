import "./style.css";

type StreamDirection = "sent" | "received" | "system";

const get = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
};

const connectionForm = get<HTMLFormElement>("connection-form");
const messageForm = get<HTMLFormElement>("message-form");
const addressInput = get<HTMLInputElement>("server-address");
const roomInput = get<HTMLInputElement>("room-name");
const connectButton = get<HTMLButtonElement>("connect-button");
const connectLabel = get<HTMLSpanElement>("connect-label");
const messageInput = get<HTMLTextAreaElement>("message-input");
const sendButton = get<HTMLButtonElement>("send-button");
const statusDot = get<HTMLSpanElement>("status-dot");
const statusText = get<HTMLSpanElement>("status-text");
const messageList = get<HTMLOListElement>("message-list");
const emptyState = get<HTMLLIElement>("empty-state");
const clearButton = get<HTMLButtonElement>("clear-button");

const defaultProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
addressInput.value = `${defaultProtocol}//${window.location.host || "localhost:8080"}/ws`;

let socket: WebSocket | null = null;
let reconnectToken = 0;

function setState(state: "disconnected" | "connecting" | "connected", detail?: string): void {
  document.body.dataset.connection = state;
  statusDot.dataset.state = state;
  statusText.textContent = detail ?? state[0]!.toUpperCase() + state.slice(1);
  const connected = state === "connected";
  const connecting = state === "connecting";
  connectLabel.textContent = connected ? "Disconnect" : connecting ? "Connecting…" : "Connect";
  connectButton.disabled = connecting;
  addressInput.disabled = connected || connecting;
  roomInput.disabled = connected || connecting;
  messageInput.disabled = !connected;
  sendButton.disabled = !connected;
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

function formatTime(date = new Date()): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function addMessage(direction: StreamDirection, content: string): void {
  emptyState.remove();
  const item = document.createElement("li");
  item.className = `message message-${direction}`;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const label = document.createElement("span");
  label.textContent = direction;
  const time = document.createElement("time");
  time.dateTime = new Date().toISOString();
  time.textContent = formatTime();
  meta.append(label, time);

  const payload = document.createElement("pre");
  payload.textContent = content;
  item.append(meta, payload);
  messageList.prepend(item);
}

function disconnect(): void {
  reconnectToken += 1;
  const activeSocket = socket;
  socket = null;
  activeSocket?.close(1000, "Disconnected by user");
  setState("disconnected");
}

function connect(): void {
  let url: string;
  try {
    url = normalizedAddress(addressInput.value.trim(), roomInput.value.trim());
  } catch (error) {
    addMessage("system", error instanceof Error ? error.message : "Invalid server address");
    return;
  }

  const token = ++reconnectToken;
  setState("connecting");
  const nextSocket = new WebSocket(url);
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    if (token !== reconnectToken) return;
    setState("connected", `Connected · ${roomInput.value.trim()}`);
    addMessage("system", `Joined room “${roomInput.value.trim()}”`);
    messageInput.focus();
  });

  nextSocket.addEventListener("message", async (event) => {
    const content = typeof event.data === "string" ? event.data : await event.data.text();
    addMessage("received", content);
  });

  nextSocket.addEventListener("error", () => {
    if (token === reconnectToken) addMessage("system", "Connection error. Check the server address.");
  });

  nextSocket.addEventListener("close", (event) => {
    if (token !== reconnectToken) return;
    socket = null;
    setState("disconnected", event.wasClean ? "Disconnected" : "Connection lost");
    if (event.code !== 1000) {
      addMessage("system", `Connection closed (${event.code}${event.reason ? `: ${event.reason}` : ""})`);
    }
  });
}

connectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (socket?.readyState === WebSocket.OPEN) disconnect();
  else connect();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = messageInput.value;
  if (!message || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(message);
  addMessage("sent", message);
  messageInput.value = "";
  messageInput.focus();
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
});

clearButton.addEventListener("click", () => {
  messageList.replaceChildren(emptyState);
});

window.addEventListener("beforeunload", () => socket?.close(1000));
setState("disconnected");
