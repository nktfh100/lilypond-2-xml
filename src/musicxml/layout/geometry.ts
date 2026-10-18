/** Approximate physical-coordinate comparisons. Musical identity uses musical-time.ts. */
export function coordinatesNear(a: number, b: number, tolerance = 1e-7): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** Page frames can be large, so their tolerance scales with the physical coordinates. */
export function coordinatesRelativelyNear(a: number, b: number, tolerance = 1e-7): boolean {
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}
