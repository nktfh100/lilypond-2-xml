import { writeArticulation } from './articulations.js';
import { musicXMLColor } from '../colors.js';
import type { Add, Notation } from '../../types.js';
import type {
  Attachment,
  DurationValue,
  Event,
  NoteLike,
  Script,
  Time,
} from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { writeOrnament } from './ornaments.js';
import { scriptFont } from './script-appearance.js';
import type { ScoreDocument } from '../../../model/document.js';

export const isBreath = (a: { class?: string }) =>
  a.class === 'breathing-event' || a.class === 'caesura-event';
const shapes: Record<string, readonly [string, string]> = {
  'scripts.rcomma': ['breath-mark', 'comma'],
  'scripts.lcomma': ['breath-mark', 'comma'],
  'scripts.rvarcomma': ['breath-mark', 'comma'],
  'scripts.lvarcomma': ['breath-mark', 'comma'],
  'scripts.raltcomma': ['breath-mark', 'comma'],
  'scripts.laltcomma': ['breath-mark', 'comma'],
  'scripts.tickmark': ['breath-mark', 'tick'],
  'scripts.uupbow': ['breath-mark', 'upbow'],
  'scripts.caesura.straight': ['caesura', 'normal'],
  'scripts.caesura.curved': ['caesura', 'curved'],
  caesura: ['caesura', 'normal'],
  curvedcaesura: ['caesura', 'curved'],
};

export function breathMarks(
  document: ScoreDocument,
  events: readonly Event[],
  notes: readonly NoteLike[],
  time: Time,
  grace: Time,
  duration: DurationValue,
  warn: Warn,
) {
  const anchors = new Map<NoteLike, Event[]>();

  for (const event of events.filter((e) => e.kind === 'voice' && isBreath(e))) {
    const candidates = notes.filter(
      (n) =>
        ['note', 'rest', 'mmrest'].includes(n.kind) &&
        !n.figureAnchor &&
        !n.cue &&
        (n.sourceVoice ?? n.voice) === event.voice &&
        n.percentCopy === event.percentCopy &&
        (grace(n)
          ? Math.abs(time(n) - time(event)) < 1e-10 &&
            Math.abs(grace(n) + duration(n.duration!) - grace(event)) < 1e-10
          : grace(event) === 0 &&
            Math.abs(time(n) + (n.segmentDuration ?? duration(n.duration!)) - time(event)) < 1e-10),
    );
    const groups = new Set(candidates.map((n) => `${time(n)}:${grace(n)}:${n.staff}:${n.kind}`));

    if (groups.size !== 1) {
      warn(
        'breath-anchor',
        'A breath or caesura has no unique preceding native note or rest endpoint. Its source event and graphics remain in metadata without a guessed following-note anchor.',
      );
      continue;
    }

    const note = candidates[0]!;
    const list = anchors.get(note) ?? [];

    list.push(event);
    anchors.set(note, list);
  }

  const graphics = events.filter((e): e is Script & Event => e.kind === 'script');
  const write = (notation: Notation, attachment: Attachment, at: Event, add: Add) => {
    const matches =
      attachment.scriptId === undefined
        ? []
        : graphics.filter(
            (g) =>
              g.id === attachment.scriptId &&
              g.staff === at.staff &&
              time(g) === time(at) &&
              grace(g) === grace(at) &&
              g.percentCopy === at.percentCopy,
          );
    const marks = matches.filter((g) => g.breathSign);

    if (!document.breathsCaptured) {
      warn(
        'breath-history',
        'Resolved breath and caesura graphics are unavailable. Native marks use event semantics without verified glyphs, colors or visibility.',
      );
    }

    if (document.breathsCaptured && !marks.length) {
      return;
    }

    const visible = marks.filter((g) => !g.hidden);

    for (const graphic of document.breathsCaptured
      ? visible.length
        ? visible
        : marks.slice(0, 1)
      : [undefined]) {
      const shape = graphic ? shapes[graphic.glyph] : undefined;
      const [element, text] =
        shape ??
        (attachment.class === 'caesura-event' ? ['caesura', 'normal'] : ['breath-mark', 'comma']);

      if (!graphic?.hidden) {
        if (graphic && !shape) {
          warn(
            'breath-glyph',
            `The source breath glyph ${graphic.glyph || 'or text'} has no verified native equivalent. Its standard event mark is retained without reproducing the custom drawing.`,
          );
        }

        if (graphic?.glyph && /(?:lcomma|[rl](?:var|alt)comma)$/.test(graphic.glyph)) {
          warn(
            'breath-variant',
            'This comma variant retains a native comma breath; its mirrored or alternate LilyPond glyph is not reproduced exactly.',
          );
        }

        if (graphic?.custom) {
          warn(
            'breath-stencil',
            'A custom breath drawing is not mapped natively. Its available standard mark and appearance remain.',
          );
        }
      }

      const color = musicXMLColor(graphic?.color ?? null);

      add(add(notation(graphic?.hidden), 'articulations'), element, text, {
        ...scriptFont(graphic, warn),
        ...(graphic?.direction ? { placement: graphic.direction < 0 ? 'below' : 'above' } : {}),
        ...(graphic?.hidden ? { color: '#00000000' } : color ? { color } : {}),
        ...(graphic?.offset?.[0] ? { 'relative-x': graphic.offset[0] * 10 } : {}),
        ...(graphic?.offset?.[1] ? { 'relative-y': graphic.offset[1] * 10 } : {}),
      });
    }
  };

  return {
    write(note: NoteLike, notation: Notation, add: Add) {
      if (!note.continuation) {
        for (const a of note.attachments ?? []) {
          if (isBreath(a)) {
            write(notation, a, note as Event, add);
          }
        }
      }

      for (const event of anchors.get(note) ?? []) {
        write(notation, event as Attachment, event, add);

        for (const a of event.attachments ?? []) {
          const graphic = graphics.find(
            (g) =>
              g.id === a.scriptId &&
              g.staff === event.staff &&
              time(g) === time(event) &&
              grace(g) === grace(event) &&
              g.percentCopy === event.percentCopy,
          );

          if (
            !writeOrnament(notation, a, graphic, document.scriptsCaptured, add, warn) &&
            !writeArticulation(notation, a, graphic, document.scriptsCaptured, add, warn)
          ) {
            warn(
              'breath-attachment',
              `An attachment at a breath requires further native mapping: ${a.class}`,
            );
          }
        }
      }
    },
  };
}
