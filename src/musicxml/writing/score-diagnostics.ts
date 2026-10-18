import type { ScoreWritingContext } from '../context.js';
import { eventTime } from '../../model/time.js';

export function reportScoreDiagnostics(context: ScoreWritingContext): void {
  const { document, warn } = context;
  const { events, boundaries, finish, timing } = context.plan;
  const { capturedAttachment } = context.normalized;
  const supportedVoice = new Set([
    'tie-event',
    'repeat-tie-event',
    'laissez-vibrer-event',
    'harmonic-event',
    'glissando-event',
    'articulation-event',
    'fingering-event',
    'stroke-finger-event',
    'bend-after-event',
    'text-script-event',
    'multi-measure-text-event',
    'absolute-dynamic-event',
    'crescendo-event',
    'decrescendo-event',
    'sustain-event',
    'sostenuto-event',
    'una-corda-event',
    'tuplet-span-event',
    'trill-span-event',
    'text-span-event',
    'slur-event',
    'phrasing-slur-event',
    'beam-event',
    'breathing-event',
    'caesura-event',
    'tremolo-event',
    'tremolo-span-event',
    'arpeggio-event',
    'string-number-event',
  ]);

  if (
    !document.tiesCaptured &&
    events.some(
      (e) =>
        ['tie-event', 'repeat-tie-event', 'laissez-vibrer-event'].includes(e.class || '') ||
        e.attachments?.some((a) =>
          ['tie-event', 'repeat-tie-event', 'laissez-vibrer-event'].includes(a.class),
        ),
    )
  ) {
    warn(
      'tie-history',
      'Resolved tie graphics are unavailable; legacy native ties use event/pitch pairing without verified notehead ownership, visibility, colors or drawing overrides.',
    );
  }

  if (
    !document.glissandosCaptured &&
    events.some(
      (e) =>
        e.class === 'glissando-event' || e.attachments?.some((a) => a.class === 'glissando-event'),
    )
  ) {
    warn(
      'glissando-history',
      'Resolved glissando graphics are unavailable; legacy native glissandi use next-note voice pairing without verified chord-note ownership, skipped columns, visibility, or drawing overrides.',
    );
  }

  if (
    !document.slursCaptured &&
    events.some(
      (e) =>
        ['slur-event', 'phrasing-slur-event'].includes(e.class || '') ||
        e.attachments?.some((a) => ['slur-event', 'phrasing-slur-event'].includes(a.class)),
    )
  ) {
    warn(
      'slur-history',
      'Resolved slur graphics are unavailable; legacy native slurs use event/voice pairing without verified numbered identities, chord-note ownership, visibility, or drawing overrides.',
    );
  }

  if (
    !document.bracketsCaptured &&
    events.some((e) => ['note-grouping-event', 'measure-spanner-event'].includes(e.class || ''))
  ) {
    warn(
      'bracket-history',
      'Resolved bracket graphics are unavailable; analysis nesting and actual measure-spanner bounds cannot be recovered reliably from the decoded events alone.',
    );
  }

  if (document.bracketsCaptured) {
    supportedVoice.add('note-grouping-event');
    supportedVoice.add('measure-spanner-event');
  }

  for (const e of events) {
    if (
      e.kind === 'layout' &&
      (e.moment.grace.numerator !== 0 || !boundaries.includes(eventTime(e))) &&
      eventTime(e) < finish
    ) {
      warn(
        'mid-measure-break',
        'A layout break inside a measure requires further placement support.',
      );
    }

    if (e.kind === 'layout' && e.class === 'page-turn-event') {
      warn('page-turn', 'Page turn permissions have no direct MusicXML representation.');
    }

    if (e.kind === 'voice' && !supportedVoice.has(e.class)) {
      warn('unmapped-event', `Unmapped event: ${e.class}`);
    }

    if (e.attachments) {
      for (const a of e.attachments) {
        if (!supportedVoice.has(a.class) && !capturedAttachment(a)) {
          warn('unmapped-attachment', `Unmapped attachment: ${a.class}`);
        }
      }
    }

    if (e.kind === 'score' && ['dal-segno-event', 'section-event'].includes(e.class || '')) {
      warn('navigation', `Navigation requires mapping: ${e.class}`);
    }
  }

  if (timing.free && !timing.captured) {
    warn(
      'cadenza-barlines',
      'Resolved barline graphics are unavailable; cadenza bars are inferred from score events.',
    );
  }

  if (
    timing.free &&
    events.some((e) => e.class === 'volta-repeat-start-event' || e.class === 'volta-span-event')
  ) {
    warn(
      'cadenza-repeat',
      'Repeat signs are retained, but playback and ending brackets inside unmetered measures require further verification.',
    );
  }

  warn(
    'engraving',
    'LilyPond engraving overrides, page layout, and rich markup are not fully represented by this exporter. Original source and resolved events are retained as MusicXML metadata.',
  );
}
