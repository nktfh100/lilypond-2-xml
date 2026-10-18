const textPointTolerance = 1e-7;

/** Resolve a captured music size only when all matching text contexts agree. */
export function musicFontSize(
  fonts: readonly { textPoints: number; musicPoints: number }[] | null | undefined,
  textPoints: number,
): number | undefined {
  const matches = fonts?.filter(
    (font) =>
      Number.isFinite(font.textPoints) &&
      Math.abs(font.textPoints - textPoints) < textPointTolerance,
  );
  const points = matches?.[0]?.musicPoints;

  return matches?.every((font) => font.musicPoints === points) ? points : undefined;
}
