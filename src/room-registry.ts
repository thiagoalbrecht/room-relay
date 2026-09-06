import type WebSocket from "ws";

export class RoomRegistry {
  private readonly rooms = new Map<string, Set<WebSocket>>();

  join(roomName: string, client: WebSocket): void {
    const room = this.rooms.get(roomName) ?? new Set<WebSocket>();
    room.add(client);
    this.rooms.set(roomName, room);
  }

  leave(roomName: string, client: WebSocket): void {
    const room = this.rooms.get(roomName);
    if (!room) return;

    room.delete(client);
    if (room.size === 0) this.rooms.delete(roomName);
  }

  peers(roomName: string, sender: WebSocket): Iterable<WebSocket> {
    const room = this.rooms.get(roomName);
    if (!room) return [];
    return [...room].filter((client) => client !== sender);
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get connectionCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.size;
    return total;
  }
}
