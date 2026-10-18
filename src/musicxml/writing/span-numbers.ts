import { availableSpanNumber } from '../primitives.js';

/** Each part allocates and releases its own native span numbers in serialization order. */
export function createSpanNumberAllocator() {
  const spanIds = new Map<string, { family: string; number: number }>();
  const allocateOrReleaseSpanNumber = (
    e: {
      voice?: number | null | undefined;
      spanDirection?: number | undefined;
    },
    name: string,
    family = name,
  ) => {
    const key = `${name}:${e.voice}`;

    if (e.spanDirection === -1) {
      const number = availableSpanNumber(
        [...spanIds.values()].filter((s) => s.family === family).map((s) => s.number),
      );

      spanIds.set(key, { family, number });
    }

    const number = spanIds.get(key)?.number || 1;

    if (e.spanDirection === 1) {
      spanIds.delete(key);
    }

    return number;
  };

  return allocateOrReleaseSpanNumber;
}
