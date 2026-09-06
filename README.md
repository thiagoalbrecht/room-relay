# Room Relay

A content-agnostic WebSocket relay for multiplayer games, collaborative tools, live dashboards, and prototypes. Clients join a room through the connection URL; every text or binary message is forwarded unchanged to the other clients in that room.

The included browser console lets you connect two tabs, choose a room, and test messages immediately.

## Run with Docker

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080), then open a second tab. Keep both tabs in the same room and send a message from either one.

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
npm install
npm run dev
```

- Browser console: `http://localhost:5173`
- WebSocket server: `ws://localhost:8080/ws`

The development browser console defaults to its own origin, so change **Server address** to `ws://localhost:8080/ws` before connecting. A production build and the Docker image serve both the UI and WebSocket API from port 8080.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the server and browser console with live reload |
| `npm run check` | Typecheck, test, and build everything |
| `npm start` | Run a completed production build |

## Configuration

| Variable | Default | Meaning |
| --- | ---: | --- |
| `PORT` | `8080` | HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `MAX_PAYLOAD_BYTES` | `65536` | Maximum WebSocket message size |
| `MESSAGES_PER_SECOND` | `100` | Per-connection message rate limit |

## Deployment notes

- Use `wss://` behind HTTPS.
- Your reverse proxy must pass WebSocket upgrade headers.
- Rooms live in one server process. For horizontal scaling, add a shared pub/sub adapter (such as Redis) and authentication appropriate to your application.
- The built-in room name and traffic limits are guardrails, not a substitute for application-level authorization.
