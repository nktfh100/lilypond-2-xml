import type {
  Attachment,
  Duration,
  Event,
  EventDocument,
  Moment,
  Pitch,
} from '@sightread/lilypond-eventdocument';

export type TextMarkup =
  | string
  | number
  | boolean
  | null
  | readonly TextMarkup[]
  | {
      command: string;
      args: readonly TextMarkup[];
      plain: string;
    };
type WithTextMarkup<T> = T extends { attachments: readonly (infer A)[] }
  ? Omit<T, 'attachments'> & {
      readonly markup?: TextMarkup;
      readonly scriptId?: number;
      readonly textColumnId?: number;
      readonly multiMeasureRest?: boolean;
      readonly attachments: readonly WithTextMarkup<A>[];
    }
  : T & {
      readonly markup?: TextMarkup;
      readonly scriptId?: number;
      readonly textColumnId?: number;
      readonly multiMeasureRest?: boolean;
    };
export type FormattedEvent = WithTextMarkup<Event> & {
  readonly repeatContext?: number;
  readonly cluster?: boolean;
  readonly quotedCue?: boolean;
  readonly cue?: boolean;
};
export type FormattedAttachment = WithTextMarkup<Attachment>;
export type StaffStepEvent = Omit<import('@sightread/lilypond-eventdocument').StepEvent, 'kind'> & {
  kind: 'staffStep';
  staff: number;
};
export interface AccidentalGraphicEvent {
  kind: 'accidentalGraphic';
  grobName: string;
  id: number;
  noteId: number | null;
  staff: number;
  moment: Moment;
  pieces: readonly {
    system: number;
    piece: number;
    hidden: boolean | null;
    custom: boolean;
    glyph: string | null;
    parenthesized: boolean;
    restoreFirst: boolean;
    color: readonly number[] | null;
    fontPoints: number | null;
  }[];
}
export interface InstrumentNameEvent {
  /** Original compiler grob identity, local to this score. */
  nameId?: number;
  color?: readonly number[] | null;
  kind: 'instrumentName';
  context: number;
  text: string;
  shortText: string;
  markup: TextMarkup | null;
  shortMarkup: TextMarkup | null;
  hidden: boolean;
  custom: boolean;
  moment: Moment;
}
export interface InstrumentLabelPieceEvent {
  kind: 'instrumentLabelPiece';
  context: number;
  nameId: number;
  system: number;
  moment: Moment;
  endMoment: Moment | null;
  text: string;
  markup: TextMarkup | null;
  color: readonly number[] | null;
  hidden: boolean;
  custom: boolean;
  /** Layout units from the first measure's start and the owning staff's top line. */
  x: number | null;
  y: number | null;
  outputScale: number;
  staffSpace: number | null;
  fontContext?: TextFontContext;
  /** Selected music-font em sizes for supported accidental markup leaves, in XML points. */
  musicFonts?: readonly { textPoints: number; musicPoints: number }[] | null;
}
export interface FinalLayoutEvent {
  kind: 'finalLayout';
  moment: Moment;
  status: 'complete' | 'failed';
  /** Actual capture lifecycle; absent in historical documents. */
  stage?: 'score' | 'book';
  attempted: boolean;
  failure: string | null;
}
export interface ArpeggioEvent {
  color?: readonly number[] | null;
  offset?: readonly [number, number];
  headPositions?: readonly (readonly [number, number])[];
  rangeReference?: readonly number[];
  rangeBase?: number | null;
  rangeStaffTop?: number | null;
  defaultX?: number | null;
  customPositions?: boolean;
  customGeometry?: boolean;
  kind: 'arpeggio';
  id: number;
  context: number;
  noteIds: readonly number[];
  style: 'normal' | 'bracket' | 'parenthesis';
  direction: number;
  side: number;
  dashed: boolean;
  fontSize: number;
  positions: readonly [number, number] | null;
  hidden: boolean;
  custom: boolean;
  moment: Moment;
}
export interface ClusterGraphicEvent {
  kind: 'clusterGraphic';
  voice: number;
  staff: number;
  noteIds: readonly number[];
  moment: Moment;
  present: boolean;
  hidden: boolean;
  custom: boolean;
  style: string | null;
  color: readonly number[] | null;
  positions: readonly [number, number] | null;
}
export interface FingerGlideLabel {
  id: number;
  kind: string;
  text: string;
  noteIds: readonly number[];
}
interface LineGraphicData {
  id: number;
  piece: number;
  voice: number;
  staff: number;
  moment: Moment;
  resolvedStart: boolean;
  endMoment: Moment | null;
  leftKind: string | null;
  fromNotes: readonly number[];
  rightKind: string | null;
  toNotes: readonly number[];
  style: string;
  color: readonly number[] | null;
  hidden: boolean;
  custom: boolean;
  dashFraction: number;
  dashPeriod: number;
  staffSpace: number | null;
  layoutStaffSpace: number | null;
  /** Final endpoint coordinates, with X relative to the observed measure origin. */
  xTenths: readonly [number | null, number | null];
  yTenths: readonly [number | null, number | null];
  xReference: readonly [Moment | null, Moment | null];
}
export interface FingerGlideEvent extends LineGraphicData {
  kind: 'fingerGlide';
  fromLabel: FingerGlideLabel | null;
  toLabel: FingerGlideLabel | null;
}
export interface MeasureLayoutEvent {
  kind: 'measureLayout';
  id: number;
  piece: number;
  staff: number;
  moment: Moment;
  endMoment: Moment;
  columnMoment: Moment | null;
  endColumnMoment: Moment | null;
  system: number;
  startXTenths: number | null;
  endXTenths: number | null;
  widthTenths: number | null;
  lineWidthTenths: number | null;
  systemLeftXTenths: number | null;
  systemRightXTenths: number | null;
  layoutStaffSpace: number | null;
  firstOnSystem: boolean;
  lastOnSystem: boolean;
  startKind: 'measure' | 'system';
  endKind: 'measure' | 'system' | 'terminal';
}
/** Exact final positions of the literal lines in one canonical TextScript column. */
export interface TextColumnPositionEvent {
  kind: 'textColumnPosition';
  id: number;
  context: number;
  staffContext: number;
  system: number;
  moment: Moment;
  momentValid?: boolean;
  units: 'system-left/staff-top-global-tenths';
  systemLeftOriginXTenths: number;
  outputScale: number;
  globalLayoutStaffSpace: number;
  globalStaffSpaceMm: number;
  lines: readonly {
    index: number;
    text: string;
    systemLeftRelativeXTenths: number;
    staffTopYTenths: number;
  }[];
}
export interface NotePositionEvent {
  kind: 'notePosition';
  noteId: number | null;
  id: number;
  piece: number;
  voice: number | null;
  staff: number | null;
  moment: Moment;
  columnMoment: Moment | null;
  xTenths: number | null;
  yTenths: number | null;
  xReference: Moment | null;
  originXTenths: number | null;
  glyphLeftXTenths: number | null;
  staffSpace: number | null;
  layoutStaffSpace: number | null;
  hidden: boolean;
  custom: boolean;
  headOnlyOffset: boolean;
  grobName: string;
}
export interface LabelEvent {
  kind: 'label';
  id: number;
  context: number;
  moment: Moment;
  columnMoment: Moment | null;
  observedMoment: Moment;
  names: readonly string[];
}
export interface CombineTextEvent {
  kind: 'combineText';
  id: number;
  piece: number;
  context: number;
  staff: number;
  moment: Moment;
  status: string | null;
  present: boolean;
  text: string | null;
  markup?: TextMarkup;
  textObserved: boolean;
  color: readonly number[] | null;
  direction: number | null;
  hidden: boolean;
  custom: boolean;
  fontContext?: TextFontContext;
  fontEncoding: string | null;
  fontName: string | null;
  musicFonts?: InstrumentLabelPieceEvent['musicFonts'];
  xTenths: number | null;
  yTenths: number | null;
  xReference: Moment | null;
  columnMoment: Moment | null;
  staffSpace: number | null;
  layoutStaffSpace: number | null;
}
export interface VowelTransitionRequestEvent {
  kind: 'vowelTransitionRequest';
  verse: number;
  voice: number | null;
  moment: Moment;
}
export interface VowelTransitionEvent {
  kind: 'vowelTransition';
  id: number;
  piece: number;
  verse: number;
  voice: number | null;
  staff: number | null;
  moment: Moment;
  resolvedStart: boolean;
  endMoment: Moment | null;
  leftKind: string | null;
  rightKind: string | null;
  fromLyricId: number | null;
  toLyricId: number | null;
  fromLyricMoment: Moment | null;
  toLyricMoment: Moment | null;
  style: string;
  color: readonly number[] | null;
  hidden: boolean;
  custom: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  xTenths: readonly [number | null, number | null];
  yTenths: readonly [number | null, number | null];
  xReference: readonly [Moment | null, Moment | null];
  staffSpace: number | null;
  layoutStaffSpace: number | null;
  dashFraction: number;
  dashPeriod: number;
  arrowLength: number | null;
  arrowWidth: number | null;
}
export interface FootnoteEvent {
  kind: 'footnote';
  id: number;
  piece: number;
  context: number;
  staff: number;
  moment: Moment;
  hostKind: string | null;
  noteId: number | null;
  body: string | null;
  markup?: TextMarkup;
  marker: string | null;
  markerMarkup?: TextMarkup;
  automaticallyNumbered: boolean;
  present: boolean;
  markerHidden: boolean;
  custom: boolean;
}
export interface LyricExtenderEvent {
  kind: 'lyricExtender';
  id: number;
  piece: number;
  verse: number;
  voice: number | null;
  staff: number | null;
  moment: Moment;
  endMoment: Moment | null;
  leftKind: string | null;
  rightKind: string | null;
  lyricMoment: Moment | null;
  headNotes: readonly (number | null)[];
  toNotes: readonly (number | null)[];
  hidden: boolean;
  custom: boolean;
  autoGenerated: boolean;
  color: readonly number[] | null;
  rectangles: OptionalMaterialEvent['rectangles'];
  xReference: Moment | null;
  staffSpace: number | null;
  layoutStaffSpace: number | null;
}
export interface MeasureCounterEvent {
  kind: 'measureCounter';
  id: number;
  piece: number;
  context: number;
  staff: number;
  moment: Moment;
  endMoment: Moment | null;
  resolvedStart: boolean;
  leftKind: string | null;
  rightKind: string | null;
  text: string | null;
  markup?: TextMarkup | null;
  fontContext?: TextFontContext | null;
  fontEncoding: 'fetaText' | 'latin1' | null;
  musicFonts?: InstrumentLabelPieceEvent['musicFonts'];
  xTenths: number | null;
  yTenths: number | null;
  xReference: Moment | null;
  staffSpace: number | null;
  layoutStaffSpace: number | null;
  color: readonly number[] | null;
  hidden: boolean;
  custom: boolean;
}
export interface BendHeadState {
  readonly noteId: number | null;
  readonly kind: string;
  readonly eligible: boolean;
  readonly hidden: boolean;
  readonly parenthesized: boolean;
  readonly stemHidden: boolean | null;
  readonly flagHidden: boolean | null;
  readonly dotsHidden: boolean | null;
  readonly beamHidden: boolean | null;
}
export interface BendGraphicEvent {
  kind: 'bendGraphic';
  id: number;
  piece: number;
  voice: number;
  staff: number;
  moment: Moment;
  resolvedStart: boolean;
  endMoment: Moment | null;
  leftKind: string | null;
  rightKind: string | null;
  fromHeads: readonly BendHeadState[];
  toHeads: readonly BendHeadState[];
  fromNotes: readonly number[];
  toNotes: readonly number[];
  quarterDifference: number | null;
  style: string | null;
  text: string;
  textCustom: boolean;
  color: readonly number[] | null;
  hidden: boolean;
  custom: boolean;
  successiveLevel: number | null;
  fontContext?: TextFontContext;
  dashSettings: readonly [number, number, number] | null;
  staffSpace: number | null;
  layoutStaffSpace: number | null;
}
export interface OptionalMaterialEvent {
  kind: 'optionalMaterial';
  id: number;
  piece: number;
  context: number;
  staff: number;
  moment: Moment;
  passageDirection: number;
  /** Actual final rectangles in global tenths: left, right, bottom, top, rounding diameter. */
  rectangles: readonly (readonly [number, number, number, number, number])[] | null;
  xReference: Moment | null;
  staffSpace: number | null;
  layoutStaffSpace: number | null;
  color: readonly number[] | null;
  hidden: boolean;
  custom: boolean;
}
export interface EpisemaEvent extends LineGraphicData {
  kind: 'episema';
}
export interface LigatureEvent {
  kind: 'ligature';
  id: number;
  piece: number;
  voice: number;
  staff: number;
  moment: Moment;
  resolvedStart: boolean;
  endMoment: Moment | null;
  name: string;
  leftKind: string | null;
  fromNotes: readonly number[];
  rightKind: string | null;
  toNotes: readonly number[];
  direction: number;
  edges: readonly [number, number];
  style: string;
  dashedEdges: boolean;
  dashFraction: number;
  dashPeriod: number;
  color: readonly number[] | null;
  hidden: boolean;
  custom: boolean;
  slur: boolean;
  /** Actual endpoint baselines relative to the owning staff top, in global tenths. */
  yTenths: readonly [number, number] | null;
  positions: readonly [number, number] | null;
  xPositions: readonly [number, number] | null;
  staffSpace: number | null;
  layoutStaffSpace: number | null;
  extraOffset: readonly [number, number];
  flare: readonly [number, number];
  shorten: readonly [number, number];
  connect: readonly [boolean, boolean];
}
export interface DurationLineEvent {
  kind: 'durationLine';
  id: number;
  piece: number;
  voice: number;
  staff: number;
  moment: Moment;
  resolvedStart: boolean;
  endMoment: Moment | null;
  leftKind: string | null;
  fromNotes: readonly number[];
  rightKind: string | null;
  toNotes: readonly number[];
  style: string;
  endStyle: string | null;
  color: readonly number[] | null;
  hidden: boolean;
  custom: boolean;
  /** Actual line baseline relative to the owning staff top, in global tenths. */
  yTenths: number | null;
  staffSpace: number | null;
  layoutStaffSpace: number | null;
  thickness: number | null;
  extraOffset: readonly [number, number];
  hookDirection: number;
  hookHeight: number;
  dashFraction: number;
  dashPeriod: number;
}
export interface BracketEvent {
  kind: 'bracket';
  id: number;
  context: number;
  staff: number;
  bracketType: 'analysis' | 'measure';
  dashFraction: number;
  dashPeriod: number;
  color: readonly number[] | null;
  textColor: readonly number[] | null;
  textCustom: boolean;
  resolvedStart: boolean;
  moment: Moment;
  endMoment: Moment | null;
  direction: number;
  edges: readonly [number, number];
  flare: readonly [number, number];
  shorten: readonly [number, number];
  style: string;
  hidden: boolean;
  custom: boolean;
  text: string;
  markup: TextMarkup;
  textHidden: boolean;
  textSize: number;
}
export interface TieStateEvent {
  kind: 'tieState';
  voice: number;
  waitForNote: boolean;
  moment: Moment;
}
export interface TieResolvedGeometry {
  tieId: number;
  system: number;
  fromNoteId: number;
  toNoteId: number;
  fromHeadId: number;
  toHeadId: number;
  fromStaffContext: number;
  toStaffContext: number;
  fromStaffSymbolContext: number;
  toStaffSymbolContext: number;
  units: 'lilypond-final-layout-coordinates';
  points: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  curveOrigin: readonly [number, number];
  fromNoteOrigin: readonly [number, number];
  toNoteOrigin: readonly [number, number];
  fromStaffTopY: number;
  toStaffTopY: number;
  outputScale: number;
  layoutStaffSpaceMm: number;
  fromLocalStaffSpaceMm: number;
  toLocalStaffSpaceMm: number;
  globalStaffSpaceMm: number;
}
export interface TieGraphicEvent {
  kind: 'tieGraphic';
  id: number;
  voice: number;
  staff: number;
  tieType: 'normal' | 'repeat' | 'laissez-vibrer';
  fromNotes: readonly number[];
  toNotes: readonly number[];
  resolvedStart: boolean;
  moment: Moment;
  endMoment: Moment | null;
  direction: number;
  color: readonly number[] | null;
  offset: readonly [number, number];
  dash: readonly (readonly number[])[];
  customControls: boolean;
  controlPoints: readonly (readonly [number, number])[] | null;
  customDetails: boolean;
  thickness: number;
  lineThickness: number;
  hidden: boolean;
  custom: boolean;
  resolvedGeometry?: TieResolvedGeometry;
}
export interface GlissandoEvent {
  kind: 'glissando';
  id: number;
  voice: number;
  staff: number;
  fromNotes: readonly number[];
  toNotes: readonly number[];
  resolvedStart: boolean;
  moment: Moment;
  endMoment: Moment | null;
  style: string;
  dashFraction: number;
  dashPeriod: number;
  color: readonly number[] | null;
  offset: readonly [number, number];
  hidden: boolean;
  custom: boolean;
  customBounds: boolean;
  thickness: number;
}
export interface SlurEvent {
  kind: 'slur';
  id: number;
  label: TextMarkup;
  voice: number;
  staff: number;
  phrasing: boolean;
  fromHead: boolean;
  toHead: boolean;
  fromNotes: readonly number[];
  toNotes: readonly number[];
  resolvedStart: boolean;
  moment: Moment;
  endMoment: Moment | null;
  direction: number;
  color: readonly number[] | null;
  offset: readonly [number, number];
  dash: readonly (readonly number[])[];
  customControls: boolean;
  controlPoints: readonly (readonly [number, number])[] | null;
  /** Final single-System source curve with actual note/staff references; absent when ownership or units are not proven. */
  resolvedGeometry?: {
    slurId: number;
    system: number;
    staffContext: number;
    staffSymbolContext: number;
    fromNoteId: number;
    toNoteId: number;
    fromHeadId: number;
    toHeadId: number;
    units: 'lilypond-final-layout-coordinates';
    points: readonly (readonly [number, number])[];
    curveOrigin: readonly [number, number];
    fromNoteOrigin: readonly [number, number];
    toNoteOrigin: readonly [number, number];
    staffTopY: number;
    outputScale: number;
    layoutStaffSpaceMm: number;
    localStaffSpaceMm: number;
    globalStaffSpaceMm: number | null;
  };
  heightLimit: number;
  ratio: number;
  thickness: number;
  hidden: boolean;
  custom: boolean;
}
export interface ScriptEvent {
  glyphMissing?: boolean;
  /** Resolved physical font-em size in MusicXML points; null means unavailable. */
  fontPoints?: number | null;
  breathSign?: boolean;
  color?: readonly number[] | null;
  offset?: readonly [number, number];
  noteId?: number;
  techniqueMarkup?: TextMarkup;
  techniqueFontStyle?: 'normal' | 'italic';
  deltaPosition?: number;
  kind: 'script';
  id: number;
  voice: number;
  staff: number;
  articulationType: string;
  axis: number;
  staffPosition: number | null;
  glyph: string;
  direction: number;
  fontSize: number;
  hidden: boolean;
  custom: boolean;
  moment: Moment;
}
export interface FigureContinuation {
  readonly color: readonly number[] | null;
  readonly offset: readonly [number, number];
  readonly hidden: boolean;
  readonly custom: boolean;
  readonly style: string;
  readonly thickness: number;
}
/** Passive post-layout BassFigure coordinates in the actual source System frame. */
export interface FigureGraphicPosition {
  units: 'layout-staff-space-tenths';
  system: number;
  staffContext: number;
  columnMoment: Moment;
  columnUsed: boolean | null;
  systemXTenths: number;
  columnXTenths: number;
  itemColumnXTenths: number;
  systemYTenths: number;
  staffTopSystemYTenths: number;
  yTenths: number;
  stencilXExtentTenths: readonly [number, number];
  stencilYExtentTenths: readonly [number, number];
  layoutStaffSpace: number;
  localStaffSpace: number;
  outputScale: number | null;
  stencilLive: boolean;
  /** Exact standard formatter leaf offsets from the BassFigure origin, in global tenths. */
  tokens?: Partial<Record<'prefix' | 'number' | 'suffix', readonly [number, number]>>;
}
export interface FiguredBassEvent {
  kind: 'figuredBass';
  context: number;
  staff: number | null;
  direction: number;
  duration: Duration;
  skip: boolean;
  alterationDirection: number;
  plusDirection: number;
  custom: boolean;
  moment: Moment;
  figures: readonly {
    id: number;
    number: number | null;
    alteration: Moment['main'] | null;
    augmented: boolean;
    diminished: boolean;
    augmentedSlash: boolean;
    bracketStart: boolean;
    bracketStop: boolean;
    alterationBracket: boolean;
    noContinuation: boolean;
    text: string | null;
    markup: TextMarkup | null;
    row: number | null;
    hidden: boolean;
    implicit: boolean;
    extendTo: number | null;
    continuation?: FigureContinuation;
    display?: TextMarkup;
    /** An associated BassFigure was observed; undefined means unknown history. */
    graphic?: boolean;
    /** Final paper-column moment; null means unattached, undefined means unresolved or uncaptured. */
    column?: Moment | null;
    /** Whether LilyPond keeps the resolved column; undefined means uncaptured or unresolved. */
    columnUsed?: boolean;
    /** Final source-page grob position; null means ownership/geometry was ambiguous. */
    graphicPosition?: FigureGraphicPosition | null;
    color?: readonly number[] | null;
    fontContext?: TextFontContext;
    numberFontContext?: FigureNumberFontContext;
    custom?: boolean;
  }[];
}
export interface NoteSizeEvent {
  kind: 'noteSize';
  noteId: number | null;
  voice: number;
  staff: number;
  eventKind: 'note' | 'rest' | 'mmrest';
  fontSize: number;
  stemFontSize: number | null;
  moment: Moment;
}
export interface NoteheadEvent {
  kind: 'notehead';
  noteId: number;
  style: string;
  glyph: string;
  durationLog: number;
  direction: number;
  hidden: boolean;
  custom: boolean;
  moment: Moment;
}
export interface PercentRepeatEvent {
  kind: 'percentRepeat';
  id: number;
  voice: number;
  staff: number;
  class: 'percent-event' | 'double-percent-event' | 'repeat-slash-event';
  length: Moment['main'];
  count: number;
  slashes: number;
  moment: Moment;
  graphics: readonly {
    name: string;
    text: string;
    hidden: boolean;
    moment: Moment;
  }[];
}
export interface BarlineLayoutEvent {
  kind: 'barlineLayout';
  barlineId: number;
  staff: number;
  moment: Moment;
  pieces: readonly {
    system: number;
    breakDirection: -1 | 0 | 1;
    glyph: string | null;
    hidden: boolean | null;
    custom: boolean;
  }[];
}
export interface BarlineEvent {
  kind: 'barline';
  id?: number;
  staff: number;
  glyph: string;
  hidden: boolean;
  moment: Moment;
}
export interface LayoutEvent {
  kind: 'layout';
  class: 'line-break-event' | 'page-break-event' | 'page-turn-event';
  moment: Moment;
  permission: 'allow' | 'force' | 'forbid' | false;
}
export interface TranspositionEvent {
  kind: 'transposition';
  staff: number;
  moment: Moment;
  pitch: Pitch;
}
export interface PercussionEvent {
  kind: 'percussion';
  noteId: number;
  staff: number;
  drumType: string;
  position: number;
  noteheadStyle: string;
  moment: Moment;
}
export interface StaffLinesEvent {
  kind: 'staffLines';
  staff: number;
  count: number;
  positions?: readonly number[] | null;
  staffSpace?: number;
  layoutStaffSpace?: number;
  hidden?: boolean;
  custom?: boolean;
  present?: boolean;
  color?: readonly number[] | null;
  /** Actual line width in normalized layout units. */
  lineWidth?: number | null;
  moment: Moment;
}
export interface PercussionScriptEvent {
  kind: 'percussionScript';
  noteId: number;
  glyph: string;
  direction: number;
  hidden: boolean;
  moment: Moment;
}
export interface TabNoteEvent {
  kind: 'tabNote';
  noteId: number;
  staff: number;
  string: number;
  fret: number | string;
  stems: boolean;
  moment: Moment;
}
export interface TabStaffEvent {
  kind: 'tabStaff';
  staff: number;
  tunings: readonly Pitch[];
  stringOneTopmost: boolean;
  capo: number;
  visibility: Readonly<Record<string, boolean>>;
  moment: Moment;
}
export interface HarmonyEvent {
  kind: 'harmony';
  context: number;
  duration: Duration;
  pitches: readonly Pitch[];
  playedPitches: readonly Pitch[];
  bass: Pitch | null;
  inversion: Pitch | null;
  text: string;
  repeated: boolean;
  skip: boolean;
  moment: Moment;
}
export interface NavigationEvent {
  kind: 'navigation';
  class:
    | 'rehearsal-mark-event'
    | 'ad-hoc-mark-event'
    | 'segno-mark-event'
    | 'coda-mark-event'
    | 'section-label-event'
    | 'dal-segno-event'
    | 'fine-event'
    | 'ad-hoc-jump-event';
  text: string;
  direction: number;
  hidden: boolean;
  finalVisible: boolean;
  markup?: TextMarkup;
  enclosure: 'none' | 'rectangle' | 'circle' | 'oval';
  bold: boolean;
  italic: boolean;
  segno: number;
  coda: number;
  returnCount: number;
  alternativeNumber: number;
  moment: Moment;
}
export type PaperSettings = Readonly<Record<string, number | boolean>>;

/** Actual completed source geometry, in normalized LilyPond page units. */
export interface PageSystemLayout {
  readonly book: number;
  readonly bookpart: number;
  /** Unique actual Paper_book within its source book; page is scoped to it. */
  readonly scope: number;
  readonly page: number;
  readonly displayedPage: number | null;
  readonly system: number;
  /** Millimeters per normalized page unit. */
  readonly outputScale: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly topMargin: number | null;
  readonly bottomMargin: number | null;
  readonly leftMargin: number | null;
  readonly rightMargin: number | null;
  readonly systemX: number | null;
  readonly systemY: number | null;
  readonly staves: readonly {
    readonly staff: number;
    /** Score-local actual StaffSymbol original and surviving printed-member identity. */
    readonly originalId?: number;
    readonly piece?: number;
    /** Actual printed piece bound-column Moments, independently nullable when unresolved. */
    readonly startMoment?: Moment | null;
    readonly endMoment?: Moment | null;
    readonly baselineY: number | null;
    /** Drawing-only displacement in page units, with positive Y down. */
    readonly inkOffset?: readonly [number, number] | null;
    readonly staffSpace: number | null;
    readonly layoutStaffSpace: number | null;
    readonly linePositions: readonly number[] | null;
    readonly hidden: boolean | null;
    readonly custom: boolean;
    readonly present: boolean;
  }[];
}
export type PageCreditValue = null | boolean | number | string | readonly PageCreditValue[];
export interface PageCreditRegion {
  readonly book: number;
  readonly bookpart: number;
  readonly scope: number;
  readonly page: number;
  readonly displayedPage: number | null;
  readonly region: 'header' | 'footer';
  readonly resolved: boolean;
  /** Millimeters per normalized source page unit. */
  readonly outputScale: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly items: readonly {
    readonly piece: number;
    readonly text: string;
    readonly fontDescription: string | null;
    /** Actual page coordinates: X rightward, Y downward, in page-layout units. */
    readonly x: number | null;
    readonly y: number | null;
    /** Additional proven text magnification beyond the Pango font description. */
    readonly fontScale: number | null;
    readonly color: readonly number[] | null;
    readonly unsupported: readonly string[];
  }[];
  readonly primitives: readonly {
    readonly command: string;
    readonly reason: string;
    readonly data: PageCreditValue;
  }[];
}
export interface TextFontContext {
  /** Point sizes use MusicXML points (1/72 inch). */
  readonly reference: number;
  readonly attrs: Readonly<Record<string, string | number>>;
  readonly unsupported: readonly string[];
}
/** Encoding-specific base context before numeric formatter markup changes its size. */
export interface FigureNumberFontContext extends TextFontContext {
  readonly encoding: 'fetaText' | 'latin1';
}
export type HeaderFontContext = TextFontContext;
export interface HeaderScopes {
  readonly book: Readonly<Record<string, TextMarkup>>;
  readonly bookStart: boolean;
  readonly printAllHeaders: boolean;
}
export type ScoreDocument = Omit<EventDocument, 'events'> & {
  /** Whether the original source Score requests printed layout. */
  layoutRequested?: boolean;
  pageLayoutsCaptured?: boolean;
  pageLayouts?: readonly PageSystemLayout[];
  pageCreditsCaptured?: boolean;
  pageCredits?: readonly PageCreditRegion[];
  headerScopes?: HeaderScopes;
  headerStyles?: Readonly<Record<string, HeaderFontContext>>;
  headerStyleBase?: HeaderFontContext;
  headerMarkup?: Readonly<Record<string, TextMarkup>>;
  pageHeaderMarkup?: Readonly<Record<string, TextMarkup>>;
  paper?: PaperSettings;
  barlinesCaptured?: boolean;
  barlineLayoutsCaptured?: boolean;
  accidentalsCaptured?: boolean;
  namesCaptured?: boolean;
  scriptsCaptured?: boolean;
  breathsCaptured?: boolean;
  arpeggiosCaptured?: boolean;
  bracketsCaptured?: boolean;
  durationLinesCaptured?: boolean;
  ligaturesCaptured?: boolean;
  fingerGlidesCaptured?: boolean;
  episemasCaptured?: boolean;
  optionalMaterialCaptured?: boolean;
  bendsCaptured?: boolean;
  measureCountersCaptured?: boolean;
  footnotesCaptured?: boolean;
  lyricExtendersCaptured?: boolean;
  notePositionsCaptured?: boolean;
  measureLayoutsCaptured?: boolean;
  labelsCaptured?: boolean;
  combineTextCaptured?: boolean;
  vowelTransitionsCaptured?: boolean;
  clustersCaptured?: boolean;
  slursCaptured?: boolean;
  glissandosCaptured?: boolean;
  tiesCaptured?: boolean;
  cueQuotes?: boolean;
  events: readonly (
    | FormattedEvent
    | StaffStepEvent
    | BarlineEvent
    | BarlineLayoutEvent
    | AccidentalGraphicEvent
    | PercentRepeatEvent
    | NoteheadEvent
    | NoteSizeEvent
    | ScriptEvent
    | ArpeggioEvent
    | BracketEvent
    | DurationLineEvent
    | LigatureEvent
    | FingerGlideEvent
    | EpisemaEvent
    | OptionalMaterialEvent
    | BendGraphicEvent
    | MeasureCounterEvent
    | FootnoteEvent
    | LyricExtenderEvent
    | NotePositionEvent
    | MeasureLayoutEvent
    | TextColumnPositionEvent
    | LabelEvent
    | CombineTextEvent
    | VowelTransitionEvent
    | VowelTransitionRequestEvent
    | ClusterGraphicEvent
    | SlurEvent
    | GlissandoEvent
    | TieGraphicEvent
    | TieStateEvent
    | FiguredBassEvent
    | InstrumentNameEvent
    | InstrumentLabelPieceEvent
    | FinalLayoutEvent
    | LayoutEvent
    | TranspositionEvent
    | PercussionEvent
    | StaffLinesEvent
    | PercussionScriptEvent
    | TabNoteEvent
    | TabStaffEvent
    | HarmonyEvent
    | NavigationEvent
  )[];
};
