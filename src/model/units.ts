/** Convert TeX points (1/72.27 inch) to PostScript points (1/72 inch). */
export const texToPostScriptPoints = (value: number) => value * (72 / 72.27);
