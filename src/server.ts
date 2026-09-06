import express from "express";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { RoomRegistry } from "./room-registry.js";

const DEFAULT_PORT = 8080;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_MESSAGES_PER_SECOND = 100;
const ROOM_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_.:-]{0,63}$/u;

interface RoomRequest extends IncomingMessage {
  roomName?: string;
}

interface LiveSocket extends WebSocket {
  isAlive: boolean;
}

export interface RealtimeServerOptions {
  maxPayloadBytes?: number;
  messagesPerSecond?: number;
  serveFrontend?: boolean;
  webRoot?: string;
}

export interface RealtimeServer {
  httpServer: HttpServer;
  rooms: RoomRegistry;
  start: (port?: number, host?: string) => Promise<AddressInfo>;
  stop: () => Promise<void>;
}

function rejectUpgrade(socket: import("node:stream").Duplex, status: number, message: string): void {
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
}

export function createRealtimeServer(options: RealtimeServerOptions = {}): RealtimeServer {
  const app = express();
  const httpServer = createServer(app);
  const rooms = new RoomRegistry();
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const messagesPerSecond = options.messagesPerSecond ?? DEFAULT_MESSAGES_PER_SECOND;
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxPayloadBytes });

  app.disable("x-powered-by");
  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      rooms: rooms.roomCount,
      connections: rooms.connectionCount,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  if (options.serveFrontend !== false) {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    const webRoot = options.webRoot ?? resolve(moduleDirectory, "../web");
    app.use(express.static(webRoot));
    app.get("/{*path}", (_request, response) => response.sendFile(resolve(webRoot, "index.html")));
  }

  httpServer.on("upgrade", (request: RoomRequest, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    } catch {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    if (url.pathname !== "/ws") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const roomName = url.searchParams.get("room")?.trim() ?? "";
    if (!ROOM_PATTERN.test(roomName)) {
      rejectUpgrade(socket, 400, "Invalid room");
      return;
    }

    request.roomName = roomName;
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
  });

  wss.on("connection", (socket: LiveSocket, request: RoomRequest) => {
    const roomName = request.roomName;
    if (!roomName) {
      socket.close(1008, "A room is required");
      return;
    }

    socket.isAlive = true;
    rooms.join(roomName, socket);

    let windowStartedAt = Date.now();
    let messagesInWindow = 0;

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    // Protocol and network errors are isolated to the affected connection.
    socket.on("error", () => {
      socket.terminate();
    });

    socket.on("message", (data, isBinary) => {
      const now = Date.now();
      if (now - windowStartedAt >= 1_000) {
        windowStartedAt = now;
        messagesInWindow = 0;
      }

      messagesInWindow += 1;
      if (messagesInWindow > messagesPerSecond) {
        socket.close(1008, "Message rate limit exceeded");
        return;
      }

      for (const peer of rooms.peers(roomName, socket)) {
        if (peer.readyState === WebSocket.OPEN) peer.send(data, { binary: isBinary });
      }
    });

    socket.once("close", () => rooms.leave(roomName, socket));
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients as Set<LiveSocket>) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  return {
    httpServer,
    rooms,
    start: (port = DEFAULT_PORT, host = "0.0.0.0") =>
      new Promise<AddressInfo>((resolveStart, rejectStart) => {
        const onError = (error: Error) => rejectStart(error);
        httpServer.once("error", onError);
        httpServer.listen(port, host, () => {
          httpServer.off("error", onError);
          resolveStart(httpServer.address() as AddressInfo);
        });
      }),
    stop: () =>
      new Promise<void>((resolveStop, rejectStop) => {
        clearInterval(heartbeat);
        for (const socket of wss.clients) socket.terminate();
        wss.close(() => {
          httpServer.close((error) => (error ? rejectStop(error) : resolveStop()));
        });
      }),
  };
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const host = process.env.HOST ?? "::";
  const server = createRealtimeServer({
    maxPayloadBytes: Number.parseInt(
      process.env.MAX_PAYLOAD_BYTES ?? String(DEFAULT_MAX_PAYLOAD_BYTES),
      10,
    ),
    messagesPerSecond: Number.parseInt(
      process.env.MESSAGES_PER_SECOND ?? String(DEFAULT_MESSAGES_PER_SECOND),
      10,
    ),
  });

  server
    .start(port, host)
    .then((address) => {
      const displayHost = host.includes(":") ? `[${host}]` : host;
      console.log(`Room Relay listening on http://${displayHost}:${address.port}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
