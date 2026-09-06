# Room Relay

A content-agnostic WebSocket relay for multiplayer games, collaborative tools, live dashboards, and prototypes. Clients join a room through the connection URL; every text or binary message is forwarded unchanged to the other clients in that room.

The included live-cursor demo lets you connect two tabs, choose a room, and see each participant's cursor move in real time.

## Run with Docker

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080), then open a second tab. Keep both tabs in the same room, connect, and move across the shared canvas.

## WebSocket API

Connect to:

```text
ws://localhost:8080/ws?room=my-room
```

Room names are 1–64 characters and may contain letters, numbers, `_`, `.`, `:`, or `-`. The server relays text and binary frames as-is to every other open connection in the same room. It does not echo a message back to its sender and does not inspect or persist payloads.

```ts
const socket = new WebSocket("ws://localhost:8080/ws?room=game-42");

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ type: "player.move", x: 12, y: 8 }));
});

socket.addEventListener("message", (event) => {
  console.log("Another client sent:", event.data);
});
```

### Health endpoint

`GET /api/health` returns the current room count, connection count, and process uptime.

## Local development

Requires Node.js 22 or later.

```bash
pnpm install
pnpm dev
```

- Browser console: `http://localhost:5173`
- WebSocket server: `ws://localhost:8080/ws`

The development browser console automatically targets the server on port 8080. A production build and the Docker image serve both the UI and WebSocket API from that port.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the server and live-cursor demo with live reload |
| `pnpm check` | Typecheck, test, and build everything |
| `pnpm start` | Run a completed production build |

## Configuration

| Variable | Default | Meaning |
| --- | ---: | --- |
| `PORT` | `8080` | HTTP and WebSocket port |
| `HOST` | `::` | Bind address (IPv6 with dual-stack support where available) |
| `MAX_PAYLOAD_BYTES` | `65536` | Maximum WebSocket message size |
| `MESSAGES_PER_SECOND` | `100` | Per-connection message rate limit |

## Deployment notes

- Use `wss://` behind HTTPS.
- Your reverse proxy must pass WebSocket upgrade headers.
- Rooms live in one server process. For horizontal scaling, add a shared pub/sub adapter (such as Redis) and authentication appropriate to your application.
- The built-in room name and traffic limits are guardrails, not a substitute for application-level authorization.

### IPv6-only hosts

The Compose build uses the host network for dependency installation, allowing Corepack and pnpm to use the host's working IPv6 route instead of an IPv4-only Docker build bridge. The application listens on `::`, its health check uses `::1`, and the Compose network has IPv6 enabled.

```bash
docker compose up --build -d
```

For a direct Docker build, pass the equivalent build network explicitly:

```bash
docker build --network=host -t room-relay .
docker run --detach --name room-relay --publish '[::]:8080:8080' room-relay
```

If Docker cannot create the IPv6 network, enable IPv6 in the Docker daemon first. For Docker Engine 27 and later, user-defined networks can receive an automatically allocated ULA subnet when IPv6 is enabled. If pnpm is being run directly on the host instead of inside Docker, prefer IPv6 DNS results for the install:

```bash
NODE_OPTIONS=--dns-result-order=ipv6first pnpm install
```
