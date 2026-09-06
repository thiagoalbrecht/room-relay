export interface RandomSource {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

export function createSessionId(
  randomSource: RandomSource | undefined = globalThis.crypto,
  fallbackRandom: () => number = Math.random,
): string {
  if (typeof randomSource?.randomUUID === "function") return randomSource.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof randomSource?.getRandomValues === "function") {
    randomSource.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(fallbackRandom() * 256);
    }
  }

  // UUID-shaped IDs keep the wire format stable without requiring a secure context.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
