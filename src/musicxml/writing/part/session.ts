import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { arpeggioMarks } from '../../notation/notes/arpeggios.js';
import { bracketNumbers } from '../../notation/spans/brackets.js';
import { breathMarks } from '../../notation/notes/breaths.js';
import { anchorFigures } from '../../notation/harmony/figured-bass.js';
import { glissandoMarks } from '../../notation/spans/glissandi.js';
import { type Event, type NameState, type NoteLike, required } from '../../planning/events.js';
import { fullNameKey, shortNameKey } from '../../text/names.js';
import type { Part } from '../../planning/parts.js';
import { planPartLyrics } from '../../planning/lyrics.js';
import { planPartNotes } from '../../planning/notes.js';
import { planMeasureEvents } from '../../planning/measure-events.js';
import { planPartTuplets } from '../../planning/tuplets.js';
import { slurMarks } from '../../notation/spans/slurs.js';
import { tieMarks } from '../../notation/spans/ties.js';
import { createTiePlaybackSession } from '../tie-session.js';
import { voiceLanes } from '../../planning/voice-lanes.js';
import { preparePartRepeats, createPartRepeatSession } from './repeats.js';
import { createPartStaffSession } from './staff.js';
import { createPartTimeWriter } from './time.js';
import { createSpanNumberAllocator } from '../span-numbers.js';
import type { ScoreWritingContext } from '../../context.js';
import { durationValue, eventGraceTime, eventTime, rationalValue } from '../../../model/time.js';
import type { LayoutSession } from '../layout-session.js';

/** Calculate part facts without registering progress or creating XML nodes. */
function calculatePartFacts(
  writingContext: ScoreWritingContext,
  layout: LayoutSession,
  part: Part,
) {
  const { partTimings, layoutMoment } = layout;
  const { ticks, notes, tick, events, barlineLayouts, partNames, figures } = writingContext.plan;
  const { warn, document } = writingContext;
  const timing = required(partTimings.get(part), 'xml-part-session.ts: partTimings.get(part)');
  const boundaries = adjustedPartBoundaries(timing.boundaries, notes);

  if (
    timing.independent &&
    part.staves.length > 1 &&
    timing.timeEvents.some((e) => {
      const primary = timing.at(eventTime(e));

      return (
        primary &&
        (primary.bar !== e.bar ||
          tick(rationalValue(primary.length)) !== tick(rationalValue(e.length)) ||
          tick(eventTime(primary) - rationalValue(primary.position)) !==
            tick(eventTime(e) - rationalValue(e.position)))
      );
    })
  ) {
    warn(
      'staff-timing-staves',
      "Staves in one MusicXML part have independent bar boundaries. Numbered native meters and note timing are retained on the first staff's measure grid; separate barlines and measure numbers for the other staves require further native support.",
    );
  }

  const staff = createPartStaffSession(writingContext, part);
  const { staffNumber, lineEvents, clefEvents, clefAt, linePlans, linePlanAt, tabSettings } =
    staff.plan;
  const arpeggios = arpeggioMarks(events, part.staves, document.arpeggiosCaptured, warn);
  const barsByMoment = new Map<number, Extract<Event, { kind: 'barline' }>>();

  for (const bar of timing.free || timing.independent
    ? timing.bars.filter(
        (e) =>
          e.staff === undefined ||
          (timing.independent && part.staves.length > 1
            ? e.staff === part.staves[0]
            : part.staves.includes(e.staff ?? NaN)),
      )
    : []) {
    const previous = barsByMoment.get(tick(eventTime(bar)));

    if (previous && (previous.glyph !== bar.glyph || previous.hidden !== bar.hidden)) {
      warn(
        'barline-staves',
        'Different barline graphics on staves in one part require separate staff-specific support.',
      );
    }

    if (!previous) {
      barsByMoment.set(tick(eventTime(bar)), bar);
    }
  }

  const sourceBarMoments = new Map(
    timing.bars
      .filter((bar) => part.staves.includes(bar.staff ?? NaN))
      .map((bar) => [eventTime(bar), bar.moment]),
  );
  const partBars: Extract<Event, { kind: 'barline' }>[] = document.barlineLayoutsCaptured
    ? [...sourceBarMoments].flatMap(([at, moment]) =>
        barlineLayouts.at(layoutMoment(at), part.staves, 'middle').bars.map((bar) => ({
          kind: 'barline' as const,
          staff: part.staves[0]!,
          moment,
          glyph: bar.glyph,
          hidden: bar.hidden,
        })),
      )
    : [...barsByMoment.values()];
  const partNotes = planPartNotes(notes, events, {
    part,
    boundaries,
    ticks,
    tick,
  });
  const { nameSeries, deferredNameUpdates } = selectPartNames(
    partNames.get(part.id) ?? [],
    boundaries,
    events,
    part,
    tick,
  );
  const breaths = breathMarks(
    document,
    events.filter((e) => part.staves.includes(e.staff ?? NaN)),
    partNotes,
    eventTime,
    eventGraceTime,
    durationValue,
    warn,
  );
  const figuredAnchors = anchorFigures(
    figures.filter((f) => part.staves.includes(f.staff)),
    partNotes,
    eventTime,
    eventGraceTime,
    durationValue,
    warn,
  );
  const voices = [...new Set(partNotes.map((e) => e.voice))];
  const voiceNumber = voiceLanes(partNotes, events, eventTime, eventGraceTime, durationValue);
  const lyricsByMoment = planPartLyrics({
    document,
    events,
    finish: writingContext.plan.finish,
    partNotes,
    warn,
  });
  const repeats = preparePartRepeats(events, writingContext.plan.ancestors, warn);
  const { tupletNumbers, tupletGapSpans } = planPartTuplets(events, {
    part,
    voices,
    voiceNumber,
  });
  const bracketIds = bracketNumbers(events, part.staves);
  const globalStaffSpace = document.paper?.['staff-space'];
  const slurs = slurMarks(
    events,
    partNotes,
    boundaries,
    voices,
    warn,
    typeof globalStaffSpace === 'number' ? globalStaffSpace : undefined,
  );
  const glissandoGraphics = glissandoMarks(events, partNotes, boundaries, voices, warn);
  const tieGraphics = tieMarks(
    events,
    partNotes,
    boundaries,
    voices,
    warn,
    typeof globalStaffSpace === 'number' ? globalStaffSpace : undefined,
  );

  return {
    plan: {
      timing,
      boundaries,
      eventsByMeasure: planMeasureEvents(
        [...events, ...writingContext.plan.navigation.targets],
        boundaries,
        writingContext.plan.finish,
        writingContext.plan.endsSection,
      ),
      staffNumber,
      lineEvents,
      clefEvents,
      clefAt,
      linePlans,
      linePlanAt,
      arpeggios,
      partBars,
      tabSettings,
      partNotes,
      nameSeries,
      breaths,
      figuredAnchors,
      voices,
      voiceNumber,
      lyricsByMoment,
      repeatEvents: repeats.repeatEvents,
      backwardEnds: repeats.backwardEnds,
      tupletNumbers,
      tupletGapSpans,
      bracketIds,
      slurs,
      glissandoGraphics,
      tieGraphics,
    },
    deferredNameUpdates,
    staffWriters: staff.writers,
  };
}

export function preparePart(
  writingContext: ScoreWritingContext,
  layout: LayoutSession,
  part: Part,
): PreparedPart {
  return calculatePartFacts(writingContext, layout, part);
}

/** Include the shared source pickup without changing layout-owned timing. */
export function adjustedPartBoundaries(
  boundaries: readonly number[],
  notes: readonly NoteLike[],
): number[] {
  const earliest = Math.min(...notes.map(eventTime), 0);

  return earliest < 0 ? [earliest, ...boundaries] : [...boundaries];
}

/** Select native name changes and return deferred piece updates for explicit registration. */
export function selectPartNames(
  names: readonly NameState[],
  boundaries: readonly number[],
  events: readonly Event[],
  part: Part,
  tick: (at: number) => number,
): {
  readonly nameSeries: NameState[];
  readonly deferredNameUpdates: readonly NameState[];
} {
  const nameSeries: NameState[] = [];
  const deferredNameUpdates: NameState[] = [];

  for (const name of names) {
    const nativeBoundary =
      boundaries.includes(eventTime(name)) &&
      !eventGraceTime(name) &&
      !events.some(
        (event) =>
          event.kind === 'note' &&
          part.staves.includes(event.staff ?? NaN) &&
          eventGraceTime(event) < 0 &&
          tick(eventTime(event)) === tick(eventTime(name)),
      );

    if (!name.pieceUpdate || nativeBoundary) {
      nameSeries.push(name);
    } else {
      deferredNameUpdates.push(name);
    }
  }

  return { nameSeries, deferredNameUpdates };
}

/** Own progress and XML references for writing an already prepared part. */
export function createPartSession(
  writingContext: ScoreWritingContext,
  part: Part,
  prepared: PreparedPart,
  partNode: XMLBuilder,
) {
  const { events, initialName } = writingContext.plan;
  const { timing, nameSeries } = prepared.plan;
  const { timeStyles, writeTime } = createPartTimeWriter(
    writingContext,
    part,
    timing,
    prepared.plan,
  );
  const repeats = createPartRepeatSession(prepared.plan, writingContext.warn);

  return {
    plan: prepared.plan,
    nodes: { partNode },
    notation: {
      nameDisplayState: {
        short: shortNameKey(initialName([...nameSeries])),
        full: fullNameKey(initialName([...nameSeries])),
      },
      tiePlayback: createTiePlaybackSession(events),
      writtenScripts: new Set<string>(),
      octaveShifts: new Map<number, number>(),
      timeStyles,
      backwardBars: repeats.backwardBars,
      forwardBars: repeats.forwardBars,
      glissandi: new Map<number, number>(),
      activeHairpins: new Map<number | null | undefined, { number: number; style: string }>(),
    },
    writers: {
      ...prepared.staffWriters,
      repeatPlays: repeats.repeatPlays,
      consumeBackwardRepeatCount: repeats.consumeBackwardRepeatCount,
      writeTime,
      allocateOrReleaseSpanNumber: createSpanNumberAllocator(),
    },
  };
}

type PreparedCollection<T> =
  T extends Map<infer K, infer V>
    ? ReadonlyMap<K, PreparedCollection<V>>
    : T extends Set<infer V>
      ? ReadonlySet<V>
      : T extends (infer V)[]
        ? readonly V[]
        : T;

type PreparedFields<T> = {
  readonly [K in keyof T]: PreparedCollection<T[K]>;
};

type CalculatedPart = ReturnType<typeof calculatePartFacts>;
type CalculatedPartPlan = CalculatedPart['plan'];

export type PreparedPartTiming = PreparedFields<CalculatedPartPlan['timing']>;

type PreparedPartPlan = PreparedFields<Omit<CalculatedPartPlan, 'timing'>> & {
  readonly timing: PreparedPartTiming;
};

export interface PreparedPart {
  readonly plan: PreparedPartPlan;
  readonly deferredNameUpdates: readonly NameState[];
  readonly staffWriters: Readonly<CalculatedPart['staffWriters']>;
}

type CreatedPartSession = ReturnType<typeof createPartSession>;
export interface PartSession {
  readonly plan: PreparedPartPlan;
  readonly nodes: Readonly<CreatedPartSession['nodes']>;
  readonly notation: CreatedPartSession['notation'];
  readonly writers: Readonly<CreatedPartSession['writers']>;
}
