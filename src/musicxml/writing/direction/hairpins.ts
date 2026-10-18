import type { Event } from '../../planning/events.js';
import type { WriteDirection } from '../measure/directions.js';

interface HairpinDirectionInput {
  readonly writeDirection: WriteDirection;
  readonly activeHairpins: Map<number | null | undefined, { number: number; style: string }>;
  readonly allocateOrReleaseSpanNumber: (
    event: {
      voice?: number | null | undefined;
      spanDirection?: number | undefined;
    },
    name: string,
    family?: string,
  ) => number;
}

/** Part-scoped hairpin state is changed only as directions are written. */
export function createHairpinDirectionWriter({
  writeDirection,
  activeHairpins,
  allocateOrReleaseSpanNumber,
}: HairpinDirectionInput) {
  const stopHairpin = (e: Event) => {
    const span = activeHairpins.get(e.voice);

    if (!span) {
      return;
    }

    writeDirection(e, span.style === 'text' ? 'dashes' : 'wedge', undefined, {
      type: 'stop',
      number: span.number,
    });
    activeHairpins.delete(e.voice);
    allocateOrReleaseSpanNumber({ ...e, spanDirection: 1 }, 'hairpin');
  };
  const writeHairpin = (e: Event) => {
    if (e.spanDirection === 1) {
      stopHairpin(e);
    } else {
      stopHairpin(e);
      const style = e.spannerStyle || 'hairpin';
      const number = allocateOrReleaseSpanNumber(
        e,
        'hairpin',
        style === 'text' ? 'dashes' : 'wedge',
      );

      activeHairpins.set(e.voice, { number, style });

      if (style === 'text') {
        writeDirection(
          e,
          'words',
          e.spannerText || e.spanText || (e.class === 'crescendo-event' ? 'cresc.' : 'dim.'),
        );
        writeDirection(e, 'dashes', undefined, { type: 'start', number });
      } else {
        writeDirection(e, 'wedge', undefined, {
          type: e.class === 'crescendo-event' ? 'crescendo' : 'diminuendo',
          number,
          ...(e.circledTip ? { niente: 'yes' } : {}),
        });
      }
    }
  };

  return { stopHairpin, writeHairpin };
}
