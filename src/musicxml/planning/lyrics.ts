import { type Event, required, type PlannedNote } from './events.js';
import { lyricExtenderPlan } from '../text/lyric-extenders.js';
import { lyricHasText, type WrittenLyric } from '../text/lyrics.js';
import type { ScoreDocument } from '../../model/document.js';
import type { Warn } from '../../model/diagnostics.js';
import { eventGraceTime, eventTime, rationalValue } from '../../model/time.js';

export function planPartLyrics({
  document,
  events,
  finish,
  partNotes,
  warn,
}: {
  document: ScoreDocument;
  events: Event[];
  finish: number;
  partNotes: PlannedNote[];
  warn: Warn;
}) {
  const lyricsByMoment = new Map<string, WrittenLyric[]>();
  const appendLyric = (voice: number | null, at: number, lyric: WrittenLyric) => {
    const key = `${voice}:${at}`;
    const entries = lyricsByMoment.get(key) || [];

    entries.push(lyric);
    lyricsByMoment.set(key, entries);
  };

  for (const verse of [...new Set(events.filter((e) => e.kind === 'lyric').map((e) => e.verse))]) {
    const verseEvents = events.filter(
      (e): e is typeof e & { kind: 'lyric' } => e.kind === 'lyric' && e.verse === verse,
    );
    const syllables = verseEvents
      .filter((e) => e.class === 'lyric-event' && lyricHasText(e.text, e.markup))
      .sort((a, b) => eventTime(a) - eventTime(b));

    for (const [index, syllable] of syllables.entries()) {
      const previous = syllables[index - 1];
      const hasHyphen = (event: Event | undefined) =>
        event &&
        verseEvents.some((e) => e.class === 'hyphen-event' && eventTime(e) === eventTime(event));
      const syllabic = hasHyphen(syllable)
        ? hasHyphen(previous)
          ? 'middle'
          : 'begin'
        : hasHyphen(previous)
          ? 'end'
          : 'single';
      const extenderPlan = lyricExtenderPlan(
        syllable,
        events,
        partNotes,
        warn,
        document.lyricExtendersCaptured === true,
      );
      const extended = extenderPlan
        ? extenderPlan.moments.length > 0
        : verseEvents.some(
            (e) => e.class === 'extender-event' && eventTime(e) === eventTime(syllable),
          );
      const until = syllables[index + 1]
        ? eventTime(required(syllables[index + 1], 'score-part-lyrics.ts: syllables[index + 1]'))
        : finish;
      const moments =
        extenderPlan && extended
          ? extenderPlan.moments.map((moment) => rationalValue(moment.main))
          : extended
            ? [
                ...new Set(
                  partNotes
                    .filter(
                      (e): e is typeof e & { kind: 'note' } =>
                        e.kind === 'note' &&
                        e.voice === syllable.voice &&
                        !eventGraceTime(e) &&
                        eventTime(e) >= eventTime(syllable) &&
                        eventTime(e) < until,
                    )
                    .map(eventTime),
                ),
              ].sort((a, b) => a - b)
            : [eventTime(syllable)];

      for (const [i, at] of moments.entries()) {
        appendLyric(syllable.voice, at, {
          verse,
          text: i === 0 ? syllable.text : undefined,
          ...(i === 0 && syllable.markup !== undefined ? { markup: syllable.markup } : {}),
          syllabic,
          ...(extenderPlan && extended
            ? {
                extendAttrs: extenderPlan.attrsAt?.(extenderPlan.moments[i]!) ?? extenderPlan.attrs,
              }
            : {}),
          extend: extended
            ? moments.length === 1
              ? 'single'
              : i === 0
                ? 'start'
                : i === moments.length - 1
                  ? 'stop'
                  : 'continue'
            : undefined,
        });
      }
    }
  }

  return lyricsByMoment;
}
