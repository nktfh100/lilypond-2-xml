import type { Moment } from '@sightread/lilypond-eventdocument';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { musicXMLColor } from '../notation/colors.js';
import { musicFontSize } from './music-fonts.js';
import type { Add } from '../types.js';
import { type Event, type NameState, type Time, isKind } from '../planning/events.js';
import type { Warn } from '../../model/diagnostics.js';
import { sameMoments as sameMoment, isMoment as validMoment } from '../../model/time.js';
import { type TextRun, textRuns, visibleText } from './runs.js';
import type { InstrumentLabelPieceEvent, ScoreDocument } from '../../model/document.js';

const accidentalNames = new Map([
  ['♭', 'flat'],
  ['♯', 'sharp'],
  ['♮', 'natural'],
  ['𝄫', 'flat-flat'],
  ['𝄪', 'double-sharp'],
]);
const fullRole = (piece: InstrumentLabelPieceEvent) =>
  piece.moment.main.numerator < 0 ||
  (piece.moment.main.numerator === 0 && piece.moment.grace.numerator <= 0);
const pieceKey = (piece: InstrumentLabelPieceEvent | undefined) =>
  piece && [
    piece.text,
    piece.markup,
    piece.hidden,
    piece.color,
    piece.fontContext,
    piece.musicFonts,
    piece.custom,
  ];
const pieceFor = (state: NameState | undefined, short: boolean) =>
  short ? state?.shortPiece : state?.fullPiece;
const hiddenFor = (state: NameState | undefined, short: boolean) =>
  pieceFor(state, short)?.hidden ?? state?.hidden;
const colorFor = (state: NameState | undefined, short: boolean) => {
  const piece = pieceFor(state, short);

  return piece ? piece.color : state?.color;
};

export function nameStates(document: ScoreDocument, events: Event[], time: Time, warn: Warn) {
  const states: NameState[] = events
    .filter((e) => e.kind === 'instrumentName')
    .map((e) => ({ ...e }));

  if (!document.namesCaptured && !states.length) {
    for (const e of events.filter(
      (e): e is Extract<Event, { kind: 'staffMeta' }> =>
        isKind(e, 'staffMeta') && !!(e.instrumentName || e.shortInstrumentName),
    )) {
      states.push({
        context: e.staff,
        text: e.instrumentName,
        shortText: e.shortInstrumentName,
        hidden: false,
        legacy: true,
        moment: {
          main: { numerator: 0, denominator: 1 },
          grace: { numerator: 0, denominator: 1 },
        },
      });
    }

    if (states.length) {
      warn(
        'instrument-name-history',
        'The decoded document contains final staff names without their initial values or change history; those names are used as a fallback.',
      );
    }
  }

  const stages = document.events.filter((e) => e.kind === 'finalLayout');

  if (stages.length === 1 && stages[0]!.status === 'complete') {
    const pieces = document.events.filter((e) => e.kind === 'instrumentLabelPiece');
    const updates: NameState[] = [];

    for (const state of states) {
      if (state.nameId === undefined) {
        continue;
      }

      if (
        !Number.isSafeInteger(state.nameId) ||
        state.nameId <= 0 ||
        states.filter((s) => s.context === state.context && s.nameId === state.nameId).length !== 1
      ) {
        warn(
          'instrument-name-piece',
          'An instrument-name identity is invalid or ambiguous. Its semantic label remains without guessed final font or drawing ownership.',
        );
        continue;
      }

      const owned = pieces.filter((p) => p.context === state.context && p.nameId === state.nameId);

      for (const short of [false, true]) {
        const role = owned
          .filter((p) => fullRole(p) !== short)
          .sort(
            (a, b) =>
              time(a) - time(b) ||
              a.moment.grace.numerator / a.moment.grace.denominator -
                b.moment.grace.numerator / b.moment.grace.denominator,
          );

        if (
          role.some((p, i) =>
            role
              .slice(i + 1)
              .some(
                (q) =>
                  time(p) === time(q) &&
                  p.moment.grace.numerator / p.moment.grace.denominator ===
                    q.moment.grace.numerator / q.moment.grace.denominator &&
                  JSON.stringify(pieceKey(p)) !== JSON.stringify(pieceKey(q)),
              ),
          )
        ) {
          warn(
            'instrument-name-piece',
            'Conflicting final instrument-name pieces share one role and moment. Its semantic label remains without selecting an arbitrary text, visibility or font.',
          );
          continue;
        }

        const first = role[0];

        if (!first) {
          continue;
        }

        if (short) {
          state.shortPiece = first;
        } else {
          state.fullPiece = first;
        }
      }

      let current = state;

      for (const piece of owned
        .slice()
        .sort(
          (a, b) =>
            time(a) - time(b) ||
            a.moment.grace.numerator / a.moment.grace.denominator -
              b.moment.grace.numerator / b.moment.grace.denominator,
        )) {
        const short = !fullRole(piece),
          first = pieceFor(current, short);

        if (!first || JSON.stringify(pieceKey(first)) === JSON.stringify(pieceKey(piece))) {
          continue;
        }

        current = {
          ...current,
          moment: piece.moment,
          pieceUpdate: true,
          ...(short ? { shortPiece: piece } : { fullPiece: piece }),
        };
        updates.push(current);
      }
    }

    states.push(...updates);
  }

  const result = new Map<number, NameState[]>();

  for (const e of states.sort((a, b) => time(a) - time(b))) {
    const series = result.get(e.context) || [];

    series.push(e);
    result.set(e.context, series);

    if (e.custom) {
      warn(
        'instrument-name-stencil',
        'A custom instrument-name drawing is not mapped; the resolved label text and markup are retained.',
      );
    }
  }

  return result;
}

const runsFor = (state: NameState | undefined, short: boolean, warn: Warn) => {
  const piece = pieceFor(state, short),
    font = piece?.fontContext;

  if (piece) {
    if (piece.custom) {
      warn(
        'instrument-name-stencil',
        'A custom final instrument-name drawing retains its observed text and visibility; arbitrary additional drawing is not mapped.',
      );
    }

    if (font?.unsupported.length) {
      warn(
        'instrument-name-font',
        `Unsupported final instrument-name font settings: ${font.unsupported.join(', ')}. Available text and styles remain.`,
      );
    }

    if (!font && !piece.hidden) {
      warn(
        'instrument-name-font-history',
        'An instrument label lacks an observed final font context for this exact name identity and full/short role. Available text and explicit styles remain without a guessed inherited size.',
      );
    }

    return textRuns(
      piece.markup ?? piece.text,
      {
        ...font?.attrs,
        ...(piece.color ? { color: musicXMLColor(piece.color) } : {}),
      },
      warn,
      font?.reference,
      (size) => musicFontSize(piece.musicFonts, size),
    );
  }

  const text = (short ? state?.shortText : state?.text) ?? '';

  if (text) {
    warn(
      'instrument-name-font-history',
      'An instrument label lacks an observed final font context for this exact name identity and full/short role. Available text and explicit styles remain without a guessed inherited size.',
    );
  }

  return textRuns(
    (short ? state?.shortMarkup : state?.markup) ?? (short ? state?.shortText : state?.text) ?? '',
    state?.color ? { color: musicXMLColor(state.color) } : {},
    warn,
    undefined,
    null,
  );
};
const content = (runs: TextRun[]) => runs.map((r) => r.text).join('');

export function writeNameDisplay(
  parent: XMLBuilder,
  kind: string,
  state: NameState | undefined,
  short: boolean,
  add: Add,
  warn: Warn,
) {
  const runs = runsFor(state, short, warn);
  const node = add(
    parent,
    kind,
    undefined,
    !visibleText(runs) || hiddenFor(state, short) ? { 'print-object': 'no' } : {},
  );

  for (const run of runs) {
    for (const text of run.text.split(/([♭♯♮𝄫𝄪])/u)) {
      if (!text) {
        continue;
      }

      const accidental = accidentalNames.get(text);

      add(
        node,
        accidental ? 'accidental-text' : 'display-text',
        accidental || text,
        accidental ? run.attrs : { ...run.attrs, 'xml:space': 'preserve' },
      );
    }
  }

  return node;
}

export function writeInitialNames(
  parent: XMLBuilder,
  type: string,
  state: NameState | undefined,
  fallback: string,
  add: Add,
  warn: Warn,
) {
  for (const [short, field] of [
    [false, 'name'],
    [true, 'abbreviation'],
  ] as const) {
    const runs = runsFor(state, short, warn),
      text = content(runs);

    if (type === 'group' && !text) {
      continue;
    }

    if (short && !text) {
      continue;
    }

    const visible = visibleText(runs) && !hiddenFor(state, short);
    const color = colorFor(state, short);

    add(parent, `${type}-${field}`, type === 'group' && !visible ? '' : text || fallback, {
      ...(type === 'part' && !visible ? { 'print-object': 'no' } : {}),
      ...(color ? { color: musicXMLColor(color) } : {}),
    });
    const markup = short ? state?.shortMarkup : state?.markup;

    if (
      (markup !== null && typeof markup === 'object') ||
      color ||
      pieceFor(state, short) ||
      (type === 'group' && !visible)
    ) {
      writeNameDisplay(parent, `${type}-${field}-display`, state, short, add, warn);
    }
  }
}

export function shortNameKey(state: NameState | undefined) {
  if (state?.shortPiece) {
    return JSON.stringify(pieceKey(state.shortPiece));
  }

  return JSON.stringify([
    state?.shortText || '',
    state?.shortMarkup || null,
    !!state?.hidden,
    state?.color ?? null,
  ]);
}

export function fullNameKey(state: NameState | undefined) {
  return JSON.stringify(pieceKey(state?.fullPiece));
}

export function writeSystemNames(
  document: ScoreDocument,
  series: readonly NameState[],
  context: number,
  system: number,
  moment: Moment,
  print: XMLBuilder,
  add: Add,
  warn: Warn,
): readonly NameState[] {
  if (!validMoment(moment)) {
    return [];
  }

  const rows = document.events.filter(
    (e): e is InstrumentLabelPieceEvent =>
      e.kind === 'instrumentLabelPiece' && e.context === context && e.system === system,
  );

  if (!rows.length) {
    return [];
  }

  if (
    rows.length !== 1 ||
    !validMoment(rows[0]!.moment) ||
    !Number.isSafeInteger(rows[0]!.nameId) ||
    rows[0]!.nameId <= 0 ||
    !sameMoment(rows[0]!.moment, moment)
  ) {
    warn(
      'instrument-name-piece',
      'An actual System label has duplicated owners, invalid name identity or a different full Moment. No display change is selected from an arbitrary source piece.',
    );

    return [];
  }

  const piece = rows[0]!,
    consumed: NameState[] = [];

  for (const short of [false, true]) {
    const owners = series.filter((s) => (short ? s.shortPiece : s.fullPiece) === piece);

    if (!owners.length) {
      continue;
    }

    const kind = short ? 'part-abbreviation-display' : 'part-name-display';

    for (const child of Array.from(print.node.childNodes)) {
      if (child?.nodeType === 1 && child.nodeName === kind) {
        print.node.removeChild(child);
      }
    }

    const display = writeNameDisplay(print, kind, owners[0], short, add, warn);

    if (!short) {
      const abbreviation = Array.from(print.node.childNodes).find(
        (n) => n?.nodeType === 1 && n.nodeName === 'part-abbreviation-display',
      );

      if (abbreviation) {
        print.node.insertBefore(display.node, abbreviation);
      }
    }

    consumed.push(...owners);
  }

  return consumed;
}
