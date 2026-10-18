import type { Moment } from '@sightread/lilypond-eventdocument';
import type { Attributes } from '../types.js';
import { type Event, type Time, required } from './events.js';
import type { Warn } from '../../model/diagnostics.js';

export function navigationRoutes(events: Event[], time: Time, warn: Warn) {
  const marks = events.filter((e) => e.kind === 'navigation');
  const codas = marks.filter((e) => e.class === 'coda-mark-event');
  const returns = marks.filter((e) => e.class === 'dal-segno-event');
  const destinations = new Map<Extract<Event, { kind: 'navigation' }>, Attributes>();

  for (const type of ['segno', 'coda']) {
    marks
      .filter((e) => e.class === `${type}-mark-event`)
      .forEach((e, i) => destinations.set(e, { [type]: `${type}-${i + 1}` }));
  }

  const backwards = new Map(
    returns.map((jump) => {
      const segno = marks
        .filter((e) => e.class === 'segno-mark-event' && time(e) < time(jump))
        .sort((a, b) => time(b) - time(a))[0];

      return [jump, segno ? { dalsegno: destinations.get(segno)?.segno } : { dacapo: 'yes' }];
    }),
  );
  const groups = new Map<
    Extract<Event, { kind: 'navigation' }>,
    Extract<Event, { kind: 'navigation' }>[]
  >();
  const sounds = new Map<Extract<Event, { kind: 'navigation' }>, Attributes[]>();
  const targets: {
    kind: 'navigationTarget';
    moment: Moment;
    target: string;
  }[] = [];

  for (const jump of returns.filter((e) => e.alternativeNumber > 0)) {
    const destinationCoda = codas.some((e) => time(e) === time(jump));
    const firstNumber = jump.coda - jump.alternativeNumber + (destinationCoda ? 0 : 1);
    const source = codas
      .filter((e) => e.coda === firstNumber && time(e) < time(jump))
      .sort((a, b) => time(b) - time(a))[0];

    if (!source) {
      warn(
        'navigation-coda',
        'The coda return text is preserved, but its source coda could not be resolved for playback.',
      );
      continue;
    }

    if (!groups.has(source)) {
      groups.set(source, []);
    }

    required(groups.get(source), 'navigation.ts: groups.get(source)').push(jump);
  }

  for (const [source, jumps] of groups) {
    jumps.sort((a, b) => time(a) - time(b));

    if (
      jumps.some(
        (e, i) =>
          e.alternativeNumber !== i + 1 ||
          !Number.isSafeInteger(e.returnCount) ||
          e.returnCount < 1,
      )
    ) {
      warn(
        'navigation-coda',
        'The coda return text is preserved, but its alternative sequence requires further playback mapping.',
      );
      continue;
    }

    let pass = 1;

    sounds.set(
      source,
      jumps.map((jump, i) => {
        pass += jump.returnCount;
        const target = `coda-route-${targets.length + 1}`;

        targets.push({ kind: 'navigationTarget', moment: jump.moment, target });

        return {
          tocoda: target,
          'time-only': Array.from(
            { length: jumps[i + 1]?.returnCount ?? 1 },
            (_, n) => pass + n,
          ).join(','),
        };
      }),
    );
  }

  return { sounds, targets, backwards, destinations };
}
