import { coordinatesNear as near } from '../../layout/geometry.js';
import type { Attributes } from '../../types.js';
import type { FigureGroup } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { momentKey } from '../../../model/time.js';
import type { FigureGraphicPosition, MeasureLayoutEvent } from '../../../model/document.js';

export interface FigurePositionAttributes {
  readonly group: Attributes;
  readonly figures: ReadonlyMap<number, Attributes>;
  readonly components?: ReadonlyMap<
    number,
    Readonly<Partial<Record<'prefix' | 'number' | 'suffix', Attributes>>>
  >;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const simpleNumberDisplay = (
  markup: FigureGroup['figures'][number]['display'],
  number: number,
): boolean => {
  if (
    !markup ||
    typeof markup !== 'object' ||
    Array.isArray(markup) ||
    !('command' in markup) ||
    typeof markup.command !== 'string' ||
    !Array.isArray(markup.args)
  ) {
    return false;
  }

  if (markup.command === 'number-markup') {
    return markup.args.length === 1 && String(markup.args[0]) === String(number);
  }

  if (markup.command === 'fontsize-markup') {
    return (
      markup.args.length === 2 &&
      finite(markup.args[0]) &&
      simpleNumberDisplay(markup.args[1] as FigureGroup['figures'][number]['display'], number)
    );
  }

  return false;
};
const tokenRoles = ['prefix', 'number', 'suffix'] as const;

type TokenRole = (typeof tokenRoles)[number];
const validTokenOffset = (value: unknown): value is readonly [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every(finite);

/** Returns undefined for legacy whole-item geometry and null for malformed or semantically mismatched token geometry. */
function tokenOffsetsFor(
  figure: FigureGroup['figures'][number],
  group: FigureGroup,
  position: FigureGraphicPosition,
): Partial<Record<TokenRole, readonly [number, number]>> | null | undefined {
  const raw = (position as FigureGraphicPosition & { tokens?: unknown }).tokens;

  if (raw === undefined) {
    return undefined;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const entries = Object.entries(raw);

  if (
    entries.some(
      ([role, offset]) => !tokenRoles.includes(role as TokenRole) || !validTokenOffset(offset),
    )
  ) {
    return null;
  }

  const offsets = raw as Partial<Record<TokenRole, readonly [number, number]>>;

  if (!offsets.number) {
    return null;
  }

  // Token roles must agree with the native semantic child the writer will create.
  // The source collector proves AST-to-stencil ownership; these checks prevent a
  // stale or malformed cache from moving a modifier onto the wrong side.
  let expectedAccessory: TokenRole | null = null;

  if (figure.alteration !== null) {
    const alteration = figure.alteration;

    if (
      !alteration ||
      !finite(alteration.numerator) ||
      !finite(alteration.denominator) ||
      alteration.denominator <= 0
    ) {
      return null;
    }

    const semitones = (alteration.numerator / alteration.denominator) * 2;

    if (![-2, -1, 0, 1, 2].includes(semitones)) {
      return null;
    }

    expectedAccessory = group.alterationDirection > 0 ? 'suffix' : 'prefix';
  }

  if (figure.augmented) {
    if (expectedAccessory !== null) {
      return null;
    }

    expectedAccessory = group.plusDirection > 0 ? 'suffix' : 'prefix';
  }

  if (
    figure.diminished ||
    figure.augmentedSlash ||
    figure.alterationBracket ||
    figure.bracketStart ||
    figure.bracketStop
  ) {
    return null;
  }

  const expected = new Set<TokenRole>(['number']);

  if (expectedAccessory) {
    expected.add(expectedAccessory);
  }

  if (
    entries.length !== expected.size ||
    entries.some(([role]) => !expected.has(role as TokenRole))
  ) {
    return null;
  }

  return offsets;
}

const validPosition = (p: FigureGraphicPosition | null | undefined): p is FigureGraphicPosition =>
  !!p &&
  typeof p === 'object' &&
  p.units === 'layout-staff-space-tenths' &&
  p.stencilLive === true &&
  p.columnUsed === true &&
  Number.isSafeInteger(p.system) &&
  p.system > 0 &&
  Number.isSafeInteger(p.staffContext) &&
  p.staffContext > 0 &&
  finite(p.systemXTenths) &&
  finite(p.yTenths) &&
  finite(p.layoutStaffSpace) &&
  p.layoutStaffSpace > 0 &&
  finite(p.localStaffSpace) &&
  p.localStaffSpace > 0 &&
  finite(p.outputScale) &&
  p.outputScale > 0 &&
  Array.isArray(p.stencilXExtentTenths) &&
  Array.isArray(p.stencilYExtentTenths) &&
  p.stencilXExtentTenths.length === 2 &&
  p.stencilYExtentTenths.length === 2 &&
  p.stencilXExtentTenths.every(finite) &&
  p.stencilYExtentTenths.every(finite) &&
  p.stencilXExtentTenths[1] >= p.stencilXExtentTenths[0] &&
  p.stencilYExtentTenths[1] >= p.stencilYExtentTenths[0];

/** Projects a whole, simple figure stack only when every row has exact source ownership. */
export function planFiguredBassPosition(
  group: FigureGroup,
  measureStart: FigureGroup['moment'],
  measureEnd: FigureGroup['moment'],
  layouts: readonly MeasureLayoutEvent[],
  globalStaffSpace: number | undefined,
  finalLayoutComplete: boolean,
  warn: Warn,
): FigurePositionAttributes | null {
  const fail = (reason: string) => {
    warn('figured-bass-position', reason);

    return null;
  };

  if (!group || typeof group !== 'object' || !Array.isArray(group.figures)) {
    return fail(
      'A cached figured-bass group has no valid figure-row list. No figured-bass coordinates are guessed.',
    );
  }

  const rows = group.figures;

  if (!rows.length) {
    return null;
  }

  if (
    group.custom ||
    rows.some(
      (figure) =>
        !figure ||
        typeof figure !== 'object' ||
        figure.graphic !== true ||
        figure.hidden ||
        figure.custom ||
        !validPosition(figure.graphicPosition) ||
        figure.number === null ||
        figure.text !== null ||
        figure.markup !== null ||
        figure.diminished ||
        figure.augmentedSlash ||
        figure.bracketStart ||
        figure.bracketStop ||
        figure.alterationBracket ||
        figure.continuation ||
        figure.implicit ||
        !Number.isSafeInteger(figure.row) ||
        figure.row! < 0,
    )
  ) {
    return fail(
      'A figured-bass group has a hidden, unsupported, composite, or uncaptured figure row. No partial row coordinates are applied.',
    );
  }

  if (!finalLayoutComplete || !finite(globalStaffSpace) || globalStaffSpace <= 0) {
    return fail(
      'Completed source layout or global MusicXML staff-space provenance is unavailable. No figured-bass coordinates are guessed.',
    );
  }

  const startKey = momentKey(measureStart),
    endKey = momentKey(measureEnd),
    groupKey = momentKey(group.moment);

  if (
    !startKey ||
    !endKey ||
    !groupKey ||
    measureStart.grace.numerator !== 0 ||
    measureEnd.grace.numerator !== 0
  ) {
    return fail(
      'The native measure interval or figured-bass moment is invalid. No figured-bass coordinates are guessed.',
    );
  }

  const positions = new Map<number, Attributes>();
  const components = new Map<number, Partial<Record<TokenRole, Attributes>>>();
  const ids = new Set<number>(),
    rowOrders = new Set<number>();

  for (const figure of rows) {
    const position = figure.graphicPosition!;

    if (
      position.staffContext !== group.staff ||
      momentKey(position.columnMoment) !== groupKey ||
      !Number.isSafeInteger(figure.id) ||
      ids.has(figure.id) ||
      rowOrders.has(figure.row!)
    ) {
      return fail(
        'A BassFigure has duplicated or mismatched source staff, system, Moment, or row ownership. No figured-bass coordinates are guessed.',
      );
    }

    ids.add(figure.id);
    rowOrders.add(figure.row!);
    const tokens = tokenOffsetsFor(figure, group, position);

    if (
      tokens === null ||
      (tokens === undefined &&
        (figure.alteration !== null ||
          figure.augmented ||
          !simpleNumberDisplay(figure.display, figure.number)))
    ) {
      return fail(
        'A figured-bass row has no complete, recognized formatter-to-glyph role mapping. No partial child coordinates are applied.',
      );
    }

    if (
      !finite(position.outputScale) ||
      !near(position.outputScale * position.layoutStaffSpace, globalStaffSpace)
    ) {
      return fail(
        "Captured source units do not agree with the document's global MusicXML staff-space. No figured-bass coordinates are guessed.",
      );
    }

    const matches = Array.isArray(layouts)
      ? layouts.filter(
          (layout) =>
            !!layout &&
            typeof layout === 'object' &&
            layout.staff === position.staffContext &&
            layout.system === position.system &&
            momentKey(layout.moment) === startKey &&
            momentKey(layout.endMoment) === endKey,
        )
      : [];

    if (matches.length !== 1) {
      return fail(
        'A BassFigure has no unique source measure with matching staff, system, and full interval. No figured-bass coordinates are guessed.',
      );
    }

    const layout = matches[0]!;

    if (
      !finite(layout.startXTenths) ||
      !finite(layout.endXTenths) ||
      !finite(layout.layoutStaffSpace) ||
      layout.layoutStaffSpace <= 0 ||
      !near(layout.layoutStaffSpace, position.layoutStaffSpace) ||
      !finite(layout.systemLeftXTenths) ||
      !finite(layout.systemRightXTenths) ||
      layout.systemRightXTenths <= layout.systemLeftXTenths ||
      position.systemXTenths < layout.systemLeftXTenths - 1e-7 ||
      position.systemXTenths > layout.systemRightXTenths + 1e-7 ||
      !['measure', 'system'].includes(layout.startKind) ||
      !['measure', 'system', 'terminal'].includes(layout.endKind)
    ) {
      return fail(
        'The matched source measure has invalid coordinate scale or system boundaries. No figured-bass coordinates are guessed.',
      );
    }

    const childAttrs = (offset: readonly [number, number] | undefined) => {
      const defaultX = position.systemXTenths + (offset?.[0] ?? 0) - layout.startXTenths;
      const defaultY = position.yTenths + (offset?.[1] ?? 0);

      return finite(defaultX) && finite(defaultY)
        ? { 'default-x': defaultX, 'default-y': defaultY }
        : null;
    };

    if (tokens) {
      const rowComponents: Partial<Record<TokenRole, Attributes>> = {};

      for (const role of tokenRoles) {
        if (tokens[role]) {
          const attrs = childAttrs(tokens[role]);

          if (!attrs) {
            return fail(
              "A token's projected measure-relative position is not finite. No figured-bass coordinates are guessed.",
            );
          }

          rowComponents[role] = attrs;
        }
      }

      positions.set(figure.id, rowComponents.number!);
      components.set(figure.id, rowComponents);
    } else {
      const attrs = childAttrs(undefined);

      if (!attrs) {
        return fail(
          'The projected figured-bass measure-relative coordinate is not finite. No figured-bass coordinates are guessed.',
        );
      }

      positions.set(figure.id, attrs);
    }
  }

  return { group: { 'default-x': 0 }, figures: positions, components };
}
