import { writeFootnotes } from '../../text/footnotes.js';
import {
  type Event,
  type PlannedNote,
  type Tick,
  required,
  percussionKey,
} from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import type { AccidentalPlan } from '../../notation/notes/accidentals.js';
import type { Part } from '../../planning/parts.js';
import type { FootnoteEvent } from '../../../model/document.js';
import { writeNotehead } from '../../notation/notes/noteheads.js';
import { noteTypeSize } from '../../notation/notes/sizes.js';
import { add } from '../../primitives.js';
import { durationValue, gcd, rationalValue } from '../../../model/time.js';
import { notationDuration, durationTypeNames } from '../../planning/rhythm.js';
import type { NoteWritingFrame } from './context.js';

type BeamStem = Extract<Event, { kind: 'beam' }>['stems'][number];

export interface NoteBeamAppearance {
  readonly stem: BeamStem;
  readonly previous: BeamStem | undefined;
  readonly next: BeamStem | undefined;
}

/** Prepared appearance facts and numbering callbacks; no writing-session access. */
export interface NoteAppearanceInput {
  readonly percussionInstruments: readonly Part['percussion'][number][];
  readonly multipleStaves: boolean;
  readonly footnotes: ReadonlyMap<number, readonly FootnoteEvent[]>;
  readonly accidentalGraphics: ReadonlyMap<number, AccidentalPlan>;
  readonly beamsByNote: ReadonlyMap<number, NoteBeamAppearance>;
  readonly voiceNumber: (voice: number) => number;
  readonly staffNumber: (staff: number) => number;
  readonly tick: Tick;
  readonly warn: Warn;
}

export function writeNoteAppearance(
  input: NoteAppearanceInput,
  e: PlannedNote,
  frame: Pick<
    NoteWritingFrame,
    | 'percussion'
    | 'node'
    | 'voice'
    | 'bendHead'
    | 'settings'
    | 'inMeasure'
    | 'chord'
    | 'tab'
    | 'head'
    | 'cluster'
  >,
) {
  const {
    percussionInstruments,
    multipleStaves,
    footnotes,
    accidentalGraphics,
    voiceNumber,
    staffNumber,
    tick,
    beamsByNote,
    warn,
  } = input;
  const { percussion, node, voice, bendHead, settings, inMeasure, chord, tab, head, cluster } =
    frame;

  if (percussion) {
    const instrument = percussionInstruments.find(
      (drum) => percussionKey(drum) === percussionKey(percussion),
    );

    if (instrument) {
      add(node, 'instrument', undefined, {
        id: instrument.instrumentId,
      });
    }
  }

  writeFootnotes(node, e, footnotes, add, warn);
  add(node, 'voice', voiceNumber(voice));
  let displayDuration = e.duration;

  if (
    e.segmentDuration !== undefined &&
    Math.abs(e.segmentDuration - durationValue(e.duration)) > 1e-10
  ) {
    const canonical = notationDuration(e.segmentDuration / rationalValue(e.duration.scale));

    if (canonical) {
      displayDuration = {
        ...canonical,
        scale: e.duration.scale,
      };
    } else {
      const base = tick(2 ** -e.duration.log * (2 - 2 ** -e.duration.dots));
      const length = tick(e.segmentDuration);
      const divisor = gcd(base, length);

      displayDuration = {
        ...e.duration,
        scale: {
          numerator: length / divisor,
          denominator: base / divisor,
        },
      };
    }
  }

  const noteType =
    ({ [-3]: 'maxima', [-2]: 'long', [-1]: 'breve' } as Record<number, string>)[
      displayDuration.log
    ] || durationTypeNames[displayDuration.log];

  if (noteType) {
    add(node, 'type', noteType, noteTypeSize(e));
  }

  for (let j = 0; j < displayDuration.dots; j++) {
    add(
      node,
      'dot',
      undefined,
      e.cluster || bendHead?.dotsHidden || settings?.visibility?.Dots === false
        ? { color: '#00000000' }
        : {},
    );
  }

  const accidental =
    !e.continuation &&
    inMeasure.find(
      (a): a is typeof a & { kind: 'accidental' } =>
        a.kind === 'accidental' && a.noteId === e.noteId,
    );

  if (accidental) {
    const name = {
      '-2': 'flat-flat',
      '-1': 'flat',
      0: 'natural',
      1: 'sharp',
      2: 'double-sharp',
      0.5: 'quarter-sharp',
      '-0.5': 'quarter-flat',
      1.5: 'three-quarters-sharp',
      '-1.5': 'three-quarters-flat',
    }[accidental.alteration * 2];

    if (name) {
      add(
        node,
        'accidental',
        accidentalGraphics.get(e.noteId ?? NaN)?.value ?? name,
        accidentalGraphics.get(e.noteId ?? NaN)?.attrs ??
          (accidental.cautionary ? { parentheses: 'yes', cautionary: 'yes' } : {}),
      );
    }
  }

  if (rationalValue(displayDuration.scale) !== 1 && e.kind !== 'mmrest') {
    const tm = add(node, 'time-modification');

    add(tm, 'actual-notes', displayDuration.scale.denominator);
    add(tm, 'normal-notes', displayDuration.scale.numerator);
  }

  if (e.cluster || bendHead?.stemHidden || e.stemHidden || e.stem || (tab && !tab.stems)) {
    add(
      node,
      'stem',
      e.cluster || bendHead?.stemHidden || e.stemHidden || (tab && !tab.stems) ? 'none' : e.stem,
    );
  }

  if (e.kind === 'note' && !tab) {
    if (bendHead?.hidden) {
      add(node, 'notehead', 'none');
    } else {
      writeNotehead(node, e, head, percussion, add, warn, cluster);
    }
  }

  if (multipleStaves) {
    add(node, 'staff', staffNumber(required(e.staff, 'xml-note-appearance.ts: e.staff')));
  }

  const beaming = beamsByNote.get(e.noteId ?? NaN);

  if (beaming && !chord && !e.continuation && settings?.visibility?.Beam !== false) {
    const { stem, previous, next } = beaming;

    for (const n of [...new Set([...stem.left, ...stem.right])].sort((a, b) => a - b)) {
      const connectedLeft = stem.left.includes(n) && previous?.right.includes(n);
      const connectedRight = stem.right.includes(n) && next?.left.includes(n);

      add(
        node,
        'beam',
        connectedLeft && connectedRight
          ? 'continue'
          : connectedRight
            ? 'begin'
            : connectedLeft
              ? 'end'
              : stem.right.includes(n)
                ? 'forward hook'
                : 'backward hook',
        {
          number: n + 1,
          ...(bendHead?.beamHidden ? { color: '#00000000' } : {}),
        },
      );
    }
  }
}
