import { barlineLayoutPlan } from '../layout/barlines.js';
import { clusterHeads } from '../notation/notes/clusters.js';
import { figureExtensions, positionFigures } from '../notation/harmony/figured-bass.js';
import { type Event, type NameState, type NoteLike, hasDuration } from './events.js';
import { labelPlans } from '../layout/labels.js';
import { measureLayoutPlan } from '../layout/measure-layout.js';
import { nameStates } from '../text/names.js';
import { navigationRoutes } from './navigation.js';
import { notePositionPlan } from '../layout/note-positions.js';
import { scriptKey } from '../notation/notes/ornaments.js';
import { staffLabelDirections } from '../layout/staff-labels.js';
import { textColumnPositionPlans } from '../layout/text-column-positions.js';
import { scoreTiming } from './timing.js';
import type { ScoreDocument } from '../../model/document.js';
import type { Warn } from '../../model/diagnostics.js';
import { durationValue, eventGraceTime, eventTime, rationalValue } from '../../model/time.js';
import { createHarmonyNotes } from './harmony-notes.js';
import { planTremolos } from './tremolos.js';
import { discoverParts } from './parts.js';
import { planRhythmicGrid } from './rhythmic-grid.js';
import type { NormalizedScore } from './normalize.js';

export function planScore(document: ScoreDocument, normalized: NormalizedScore, warn: Warn) {
  const labels = labelPlans(document, warn);
  const notePositions = notePositionPlan(document, warn);
  const measureLayouts = measureLayoutPlan(document, warn);
  const textColumnPositions = textColumnPositionPlans(document, warn);
  const barlineLayouts = barlineLayoutPlan(document, warn);
  const navigation = navigationRoutes(normalized.events, eventTime, warn);
  const endsSection = (e: Event) =>
    ['dal-segno-event', 'fine-event', 'ad-hoc-jump-event'].includes(e.class || '');
  const { events, context, ancestors, staffIds, semanticFigures, harmonies, parts } = discoverParts(
    document,
    normalized.events,
  );
  const clustersByNote = clusterHeads(events, warn);
  const noteheadsByNote = new Map(
    events.filter((e) => e.kind === 'notehead').map((e) => [e.noteId, e]),
  );
  const scripts = new Map(
    events.filter((e) => e.kind === 'script').map((e) => [scriptKey(e.id, e.voice, e.moment), e]),
  );
  const tabByNote = new Map(events.filter((e) => e.kind === 'tabNote').map((e) => [e.noteId, e]));
  const percussionByNote = new Map(
    events.filter((e) => e.kind === 'percussion').map((e) => [e.noteId, e]),
  );
  const names = nameStates(document, events, eventTime, warn);
  const staffLabels = staffLabelDirections(document, eventTime, warn);
  const initialName = (series: NameState[] | undefined) =>
    series?.findLast((e) => eventTime(e) <= 0);
  const partNames = new Map(
    parts.map((part) => {
      const children = part.staves
        .filter((s) => s !== part.contextId)
        .flatMap((s) => names.get(s) || []);

      if (
        children.some(
          (e) => !e.hidden && (e.text || e.shortText) && !staffLabels.covered(e.context),
        )
      ) {
        warn(
          'instrument-name-staves',
          'Separate labels on staves within one MusicXML part are not yet placed independently; their text and change history remain in the resolved event metadata.',
        );
      }

      return [
        part.id,
        names.get(part.contextId) ||
          (document.namesCaptured ? [] : children.filter((e) => e.legacy)),
      ];
    }),
  );
  const { harmonyStaff, notes: chordNotes } = createHarmonyNotes({
    harmonies,
    context,
    parts,
    ancestors,
    staffIds,
  });
  const baseNotes = events.filter(hasDuration).concat(chordNotes);
  const notes = baseNotes.concat(
    semanticFigures
      .filter(
        (f) =>
          !baseNotes.some(
            (n) =>
              n.staff === f.staff &&
              n.kind !== 'skip' &&
              !eventGraceTime(n) &&
              eventTime(n) <= eventTime(f) &&
              eventTime(n) + durationValue(n.duration) > eventTime(f),
          ),
      )
      .map((f): NoteLike => ({
        kind: 'rest',
        staff: f.staff,
        voice: f.context,
        duration: f.duration,
        moment: f.moment,
        hidden: true,
        stemHidden: true,
        attachments: [],
        figureAnchor: true,
      })),
  );
  const sourceFinish = Math.max(
    0,
    ...[...notes, ...harmonies, ...semanticFigures].map(
      (event) => eventTime(event) + (eventGraceTime(event) ? 0 : durationValue(event.duration)),
    ),
  );
  const figures = positionFigures(
    semanticFigures,
    notes,
    sourceFinish,
    eventTime,
    eventGraceTime,
    warn,
  );
  const sourceMeasureLayouts = document.events.filter(
    (event): event is Extract<Event, { kind: 'measureLayout' }> => event.kind === 'measureLayout',
  );
  const finalLayoutComplete =
    document.events.some((event) => event.kind === 'finalLayout' && event.status === 'complete') &&
    !document.events.some((event) => event.kind === 'finalLayout' && event.status === 'failed');
  const globalFigureStaffSpace =
    typeof document.paper?.['staff-space'] === 'number' ? document.paper['staff-space'] : undefined;

  for (const e of events) {
    if (e.kind === 'script' && e.glyphMissing) {
      warn(
        'script-font-glyph',
        'The resolved standard script font produced an empty source glyph. Native semantics remain hidden instead of restoring a visible mark absent from LilyPond.',
      );
    }
  }

  const { ticks, tick } = planRhythmicGrid(events, figures);
  const beamsByNote = new Map(
    events
      .filter((e) => e.kind === 'beam')
      .flatMap((e) =>
        e.stems.map((stem, index) => [
          stem.noteId,
          { stem, previous: e.stems[index - 1], next: e.stems[index + 1] },
        ]),
      ),
  );
  const { tremolosByNote } = planTremolos(events, notes, warn);
  const finish = Math.max(
    ...[...notes, ...harmonies, ...semanticFigures].map(
      (e) =>
        (tick(eventTime(e)) + (eventGraceTime(e) ? 0 : tick(durationValue(e.duration)))) / ticks,
    ),
    0,
  );
  const extensions = figureExtensions(figures, eventTime, warn, semanticFigures);

  for (const figure of figures) {
    const at = eventTime(figure);

    if (
      at >= finish - 1e-10 ||
      notes.some(
        (n) =>
          n.staff === figure.staff &&
          n.kind !== 'skip' &&
          !eventGraceTime(n) &&
          eventTime(n) <= at + 1e-10 &&
          eventTime(n) + durationValue(n.duration) > at + 1e-10,
      )
    ) {
      continue;
    }

    const next = Math.min(
      finish,
      ...notes
        .filter((n) => n.staff === figure.staff && !eventGraceTime(n) && eventTime(n) > at + 1e-10)
        .map(eventTime),
    );
    const length = Math.min(durationValue(figure.duration), next - at);

    if (tick(length) <= 0) {
      continue;
    }

    notes.push({
      kind: 'rest',
      staff: figure.staff,
      voice: figure.context,
      duration: {
        log: 0,
        dots: 0,
        scale: { numerator: tick(length), denominator: ticks },
      },
      moment: {
        main: figure.moment.main,
        grace: { numerator: 0, denominator: 1 },
      },
      hidden: true,
      stemHidden: true,
      attachments: [],
      figureAnchor: true,
    });
  }

  const timing = scoreTiming({
    events,
    finish,
    time: eventTime,
    value: rationalValue,
    tick,
    ticksPerWholeNote: ticks,
    captured: document.barlinesCaptured,
  });
  const boundaries = timing.boundaries;

  if (Math.min(...notes.map(eventTime), 0) < 0) {
    boundaries.unshift(Math.min(...notes.map(eventTime)));
  }

  return {
    events,
    labels,
    notePositions,
    measureLayouts,
    textColumnPositions,
    barlineLayouts,
    navigation,
    endsSection,
    context,
    ancestors,
    clustersByNote,
    noteheadsByNote,
    scripts,
    tabByNote,
    percussionByNote,
    parts,
    names,
    staffLabels,
    initialName,
    partNames,
    harmonyStaff,
    notes,
    figures,
    sourceMeasureLayouts,
    finalLayoutComplete,
    globalFigureStaffSpace,
    ticks,
    tick,
    beamsByNote,
    tremolosByNote,
    finish,
    extensions,
    timing,
    boundaries,
  };
}

export type ScorePlan = ReturnType<typeof planScore>;
