import type { Duration, Moment, Rational } from '@sightread/lilypond-eventdocument';

/** Collector time is exact: both fields are safe integers and denominators are positive. */
export function isRational(value: unknown): value is Rational {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const ratio = value as Partial<Rational>;

  return (
    Number.isSafeInteger(ratio.numerator) &&
    Number.isSafeInteger(ratio.denominator) &&
    Number(ratio.denominator) > 0
  );
}

export function isMoment(value: unknown): value is Moment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const moment = value as Partial<Moment>;

  return isRational(moment.main) && isRational(moment.grace);
}

/** Cross products use BigInt so ordering cannot lose a small difference at large onsets. */
export function compareRational(a: Rational, b: Rational): number {
  const delta =
    BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator);

  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

export function compareMoments(a: Moment, b: Moment): number {
  return compareRational(a.main, b.main) || compareRational(a.grace, b.grace);
}

export function sameMoments(a: unknown, b: unknown): boolean {
  return isMoment(a) && isMoment(b) && compareMoments(a, b) === 0;
}

/** Canonical keys also validate untrusted sidecar data; malformed values have no identity. */
export function rationalKey(value: Rational): string;
export function rationalKey(value: unknown): string | null;

export function rationalKey(value: unknown): string | null {
  if (!isRational(value)) {
    return null;
  }

  const numerator = BigInt(value.numerator),
    denominator = BigInt(value.denominator);
  let a = numerator < 0n ? -numerator : numerator,
    b = denominator;

  while (b) {
    const remainder = a % b;

    a = b;
    b = remainder;
  }

  return `${numerator / a}/${denominator / a}`;
}

export function momentKey(value: Moment): string;
export function momentKey(value: unknown): string | null;

export function momentKey(value: unknown): string | null {
  if (!isMoment(value)) {
    return null;
  }

  return `${rationalKey(value.main)}:${rationalKey(value.grace)}`;
}

/** Approximate conversion for native numeric offsets and geometry, never temporal identity. */
export const rationalValue = (value: Rational): number => value.numerator / value.denominator;
export const mainTime = (moment: Moment): number => rationalValue(moment.main);

/** Numeric projections for serialization and geometry, never exact event identity. */
export const eventTime = (event: { moment: Moment }): number => mainTime(event.moment);
export const eventGraceTime = (event: { moment: Moment }): number =>
  rationalValue(event.moment.grace);
export const durationValue = (d: Duration) =>
  2 ** -d.log * (2 - 2 ** -d.dots) * rationalValue(d.scale);

export function isDuration(value: unknown): value is Duration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const duration = value as Partial<Duration>;

  if (
    typeof duration.log !== 'number' ||
    !Number.isSafeInteger(duration.log) ||
    typeof duration.dots !== 'number' ||
    !Number.isSafeInteger(duration.dots) ||
    duration.dots < 0 ||
    !isRational(duration.scale) ||
    duration.scale.numerator <= 0
  ) {
    return false;
  }

  const length = durationValue({
    log: duration.log,
    dots: duration.dots,
    scale: duration.scale,
  });

  return Number.isFinite(length) && length > 0;
}

/** Nonnegative greatest common divisor, including zero and negative operands. */
export const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
export const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;
