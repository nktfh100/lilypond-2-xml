import type {
  Duration,
  Moment,
  NoteEvent,
  Rational,
  RestEvent,
} from '@sightread/lilypond-eventdocument';
import type {
  BendGraphicEvent,
  BracketEvent,
  CombineTextEvent,
  DurationLineEvent,
  EpisemaEvent,
  FingerGlideEvent,
  FormattedAttachment,
  InstrumentLabelPieceEvent,
  InstrumentNameEvent,
  LigatureEvent,
  MeasureCounterEvent,
  OptionalMaterialEvent,
  ScoreDocument,
  ScriptEvent,
  TextMarkup,
  VowelTransitionEvent,
} from '../../model/document.js';
import { isDuration } from '../../model/time.js';

type UnionKeys<T> = T extends unknown ? keyof T : never;
/** Add optional never properties for keys present only on other union members. */
type WithAbsentUnionProperties<T, K extends PropertyKey = UnionKeys<T>> = T extends unknown
  ? T & Partial<Record<Exclude<K, keyof T>, never>>
  : never;
export type Attachment = WithAbsentUnionProperties<
  FormattedAttachment & {
    direction?: number | null;
  }
>;
export type BracketPoint = Omit<BracketEvent, 'kind'> & {
  kind: 'bracketPoint';
  point: 'start' | 'stop' | 'label';
  spanKey: string;
};
export type DurationLinePoint = Omit<DurationLineEvent, 'kind'> & {
  kind: 'durationLinePoint';
  point: 'start' | 'stop';
  spanKey: string;
};
export type LigaturePoint = Omit<LigatureEvent, 'kind'> & {
  kind: 'ligaturePoint';
  point: 'start' | 'stop';
  spanKey: string;
};
export type FingerGlidePoint = Omit<FingerGlideEvent, 'kind'> & {
  kind: 'fingerGlidePoint';
  point: 'start' | 'stop';
  spanKey: string;
};
export type EpisemaPoint = Omit<EpisemaEvent, 'kind'> & {
  kind: 'episemaPoint';
  point: 'start' | 'stop';
  spanKey: string;
};
export type OptionalMaterialPoint = Omit<OptionalMaterialEvent, 'kind'> & {
  kind: 'optionalMaterialPoint';
  ySupported: boolean;
  segment: number;
  point: 'start' | 'stop';
  spanKey: string;
  endMoment: Moment;
};
export type BendHoldPoint = Omit<BendGraphicEvent, 'kind'> & {
  kind: 'bendHoldPoint';
  point: 'start' | 'stop';
  spanKey: string;
};
export type MeasureCounterPoint = Omit<MeasureCounterEvent, 'kind'> & {
  kind: 'measureCounterPoint';
};
export type CombineTextPoint = Omit<CombineTextEvent, 'kind'> & {
  kind: 'combineTextPoint';
};
export type VowelTransitionPoint = Omit<VowelTransitionEvent, 'kind' | 'staff'> & {
  kind: 'vowelTransitionPoint';
  staff: number;
  point: 'start' | 'stop';
  spanKey: string;
};
type SourceEvent = ScoreDocument['events'][number];
export type Timed = { readonly moment: Moment };

export type Time = (event: Timed) => number;
export type Value = (value: Rational) => number;
export type Tick = (value: number) => number;
export type DurationValue = (duration: Duration) => number;
export type NameState = Omit<InstrumentNameEvent, 'kind' | 'markup' | 'shortMarkup' | 'custom'> & {
  markup?: TextMarkup | null;
  shortMarkup?: TextMarkup | null;
  custom?: boolean;
  legacy?: boolean;
  fullPiece?: InstrumentLabelPieceEvent;
  shortPiece?: InstrumentLabelPieceEvent;
  pieceUpdate?: boolean;
};
/** Presentation metadata is valid on notes and standalone direction events. */
export interface EventPresentation {
  markup?: TextMarkup;
  scriptId?: number;
  multiMeasureRest?: boolean;
  direction?: number | null;
  percentCopy?: number;
  notationSize?: string;
}
/** These fields describe note carriers and never decorate unrelated events. */
export interface NoteExtras extends EventPresentation {
  segmentDuration?: number;
  continuation?: boolean;
  continues?: boolean;
  tieAtEnd?: boolean;
  sourceVoice?: number;
  figureAnchor?: boolean;
  cluster?: boolean;
  quotedCue?: boolean;
  cue?: boolean;
}
type WithCarrierExtras<T> = T extends {
  kind: 'note' | 'rest' | 'mmrest' | 'skip';
}
  ? T & NoteExtras
  : T & EventPresentation;
/** Compiler and synthetic notes may omit visual details until score planning. */
export type RawNote = {
  kind: 'note';
  moment: Moment;
  voice: number;
  staff: number;
  duration: Duration | null;
  attachments: readonly Attachment[];
} & Partial<Omit<NoteEvent, 'kind' | 'moment' | 'voice' | 'staff' | 'duration' | 'attachments'>>;
type Rest = Omit<RestEvent, 'duration'> & {
  duration: Duration | null;
  attachments?: readonly Attachment[];
  hidden?: boolean;
  stemHidden?: boolean;
};
export type Event = WithAbsentUnionProperties<
  WithCarrierExtras<
    | Exclude<SourceEvent, { kind: 'note' | 'rest' | 'mmrest' | 'skip' | 'barline' }>
    | (Omit<import('../../model/document.js').BarlineEvent, 'staff'> & {
        staff?: number;
      })
    | RawNote
    | Rest
    | BracketPoint
    | DurationLinePoint
    | LigaturePoint
    | FingerGlidePoint
    | EpisemaPoint
    | OptionalMaterialPoint
    | BendHoldPoint
    | MeasureCounterPoint
    | CombineTextPoint
    | VowelTransitionPoint
    | { kind: 'navigationTarget'; moment: Moment; target: string }
  >
>;
/** A timed carrier whose duration has been validated for rhythmic planning. */
export type ValidatedNote = Extract<Event, { kind: 'note' | 'rest' | 'mmrest' | 'skip' }> & {
  duration: Duration;
};
/** A note split at the part measure boundaries, ready for serialization. */
export type PlannedNote = ValidatedNote & {
  segmentDuration: number;
  continuation: boolean;
  continues: boolean;
  tieAtEnd: boolean;
};

export type NoteLike = ValidatedNote;

export type FigureGroup = import('../../model/document.js').FiguredBassEvent & {
  staff: number;
};
export type Script = ScriptEvent;

export function isKind<T extends Event, K extends T['kind']>(
  event: T,
  ...kinds: K[]
): event is T & { kind: K } {
  return kinds.some((kind) => kind === event.kind);
}

export function required<T>(value: T | null | undefined, context: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Missing required score data: ${context}`);
  }

  return value;
}

export function hasDuration(event: Event): event is ValidatedNote {
  return isKind(event, 'note', 'rest', 'mmrest', 'skip') && isDuration(event.duration);
}

export const percussionKey = (e: Extract<Event, { kind: 'percussion' }>) =>
  `${e.staff}:${e.drumType}:${e.position}:${e.noteheadStyle}`;
