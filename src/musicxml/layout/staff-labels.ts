import type { Moment } from '@sightread/lilypond-eventdocument';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { musicXMLColor } from '../notation/colors.js';
import type { Add } from '../types.js';
import type { Time } from '../planning/events.js';
import type { Warn } from '../../model/diagnostics.js';
import {
  rationalKey,
  sameMoments as sameMoment,
  isMoment as validMoment,
} from '../../model/time.js';
import type { Part } from '../planning/parts.js';
import { textRuns, visibleText } from '../text/runs.js';
import type { InstrumentLabelPieceEvent, ScoreDocument } from '../../model/document.js';

export function staffLabelDirections(document: ScoreDocument, time: Time, warn: Warn) {
  const stages = document.events.filter((e) => e.kind === 'finalLayout');
  const complete = stages.length === 1 && stages[0]!.status === 'complete';

  for (const stage of stages) {
    if (stage.status === 'failed') {
      warn(
        'instrument-label-capture',
        `Final instrument-label layout could not be captured. Initial labels and source history remain; independent margin positions are omitted. ${stage.failure ?? ''}`,
      );
    }
  }

  const pieces = complete ? document.events.filter((e) => e.kind === 'instrumentLabelPiece') : [];
  const space = document.paper?.['staff-space'];
  const valid = (p: InstrumentLabelPieceEvent, positionX = true) =>
    Number.isSafeInteger(p.system) &&
    p.system > 0 &&
    (!positionX || (p.x !== null && Number.isFinite(p.x))) &&
    p.y !== null &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.outputScale) &&
    p.outputScale > 0 &&
    typeof space === 'number' &&
    space > 0;
  const independent = (part: Part, p: InstrumentLabelPieceEvent) =>
    part.staves.includes(p.context) && p.context !== part.contextId;
  const pending = new Set<InstrumentLabelPieceEvent>(),
    written = new Set<InstrumentLabelPieceEvent>();
  const mainKey = (m: Moment) => rationalKey(m.main);
  const graceMains = new Map<number, Set<string>>();

  for (const note of document.events.filter((e) => e.kind === 'note')) {
    if (note.staff === undefined || !validMoment(note.moment) || note.moment.grace.numerator >= 0) {
      continue;
    }

    const mains = graceMains.get(note.staff) ?? new Set<string>();

    mains.add(mainKey(note.moment));
    graceMains.set(note.staff, mains);
  }

  const sharesGraceMain = (part: Part, p: InstrumentLabelPieceEvent) =>
    validMoment(p.moment) &&
    part.staves.some((staff) => graceMains.get(staff)?.has(mainKey(p.moment)));
  const writePiece = (
    part: Part,
    parent: XMLBuilder,
    piece: InstrumentLabelPieceEvent,
    add: Add,
    positionX = true,
  ) => {
    if (written.has(piece) || piece.hidden) {
      return undefined;
    }

    if (!valid(piece, positionX)) {
      warn(
        'instrument-label-position',
        'An independent staff label lacks a valid final staff coordinate reference or global scale. Its native margin text is omitted without guessed positions.',
      );

      return undefined;
    }

    const color = musicXMLColor(piece.color),
      factor = (10 * piece.outputScale) / (space as number);
    const base = {
      ...piece.fontContext?.attrs,
      ...(color ? { color } : {}),
      ...(positionX ? { 'default-x': piece.x! * factor } : {}),
      'default-y': piece.y! * factor,
      halign: 'left',
      valign: 'baseline',
    };
    const runs = textRuns(piece.markup ?? piece.text, base, warn, piece.fontContext?.reference);

    if (!visibleText(runs)) {
      return undefined;
    }

    if (!positionX) {
      warn(
        'instrument-label-reference',
        'A label at an intra-measure cursor retains its text, staff baseline and styles. Its native System-start X reference is unproven and remains metadata.',
      );
    }

    if (runs.length > 1) {
      warn(
        'instrument-label-markup',
        'A staff label retains its styled native text runs and final baseline. Independent positions for mixed styles or composite markup remain unverified.',
      );
    }

    if (piece.custom) {
      warn(
        'instrument-label-stencil',
        'A custom instrument-label drawing retains its available text at the final baseline. Arbitrary additional drawing is not mapped.',
      );
    }

    if (piece.fontContext?.unsupported.length) {
      warn(
        'instrument-label-font',
        `Unsupported final instrument-label font settings: ${piece.fontContext.unsupported.join(', ')}. Available text and styles remain.`,
      );
    }

    if (!piece.fontContext) {
      warn(
        'instrument-label-font-history',
        'A final staff label lacks resolved font context. Its available native text and baseline remain without a guessed point size.',
      );
    }

    const direction = add(parent, 'direction'),
      type = add(direction, 'direction-type');

    for (const run of runs) {
      add(type, 'words', run.text, { ...run.attrs, 'xml:space': 'preserve' });
    }

    add(direction, 'staff', part.staves.indexOf(piece.context) + 1);
    written.add(piece);
    pending.delete(piece);

    return direction;
  };

  return {
    covered: (context: number) =>
      pieces.some((p) => p.context === context) &&
      pieces.filter((p) => p.context === context).every((p) => p.hidden || valid(p)),
    starts: (part: Part, at: number) =>
      pieces.some(
        (p) =>
          independent(part, p) &&
          !p.hidden &&
          p.system > 1 &&
          time(p) === at &&
          p.moment.grace.numerator === 0 &&
          !sharesGraceMain(part, p) &&
          valid(p),
      ),
    write(part: Part, measure: XMLBuilder, start: number, end: number, add: Add) {
      for (const piece of pieces.filter(
        (p) => independent(part, p) && time(p) >= start && time(p) < end,
      )) {
        if (piece.hidden) {
          continue;
        }

        if (
          time(piece) !== start ||
          (piece.system > 1 && (piece.moment.grace.numerator !== 0 || sharesGraceMain(part, piece)))
        ) {
          pending.add(piece);
          continue;
        }

        writePiece(part, measure, piece, add);
      }
    },
    writeAt(
      part: Part,
      parent: XMLBuilder,
      system: number,
      moment: Moment,
      add: Add,
      positionX = true,
    ): readonly XMLBuilder[] {
      if (!Number.isSafeInteger(system) || system <= 0 || !validMoment(moment)) {
        return [];
      }

      const rows = pieces.filter((p) => independent(part, p) && p.system === system);
      const out: XMLBuilder[] = [];

      for (const staff of part.staves) {
        const owned = rows.filter((p) => p.context === staff);

        if (!owned.length) {
          continue;
        }

        if (
          owned.length !== 1 ||
          !Number.isSafeInteger(owned[0]!.nameId) ||
          owned[0]!.nameId <= 0 ||
          !validMoment(owned[0]!.moment) ||
          !sameMoment(owned[0]!.moment, moment)
        ) {
          warn(
            'instrument-label-piece',
            'An actual System has duplicated label owners, invalid name identities or inconsistent full Moments. No arbitrary final label is selected.',
          );
          continue;
        }

        const node = writePiece(part, parent, owned[0]!, add, positionX);

        if (node) {
          out.push(node);
        }
      }

      return out;
    },
    finish() {
      if ([...pending].some((p) => !written.has(p))) {
        warn(
          'instrument-label-system',
          'A source system starts inside a native measure. Its independent margin label remains in metadata until the source break can be mapped to a native system boundary.',
        );
      }
    },
  };
}
