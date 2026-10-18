import { create } from '../xml-builder.js';
import { writeHeaderCredits } from '../text/headers.js';
import { shortNameKey, writeInitialNames } from '../text/names.js';
import { writePaper } from '../layout/paper.js';
import { writeSizeDefaults } from '../notation/notes/sizes.js';
import { createLayoutSession } from './layout-session.js';
import { writePart } from './part/write.js';
import type { ScoreWritingContext } from '../context.js';
import { add } from '../primitives.js';
import { eventTime } from '../../model/time.js';

/** Writes native nodes; each part owns its notation and playback state. */
export function writeScore(writingContext: ScoreWritingContext) {
  const { document, options, normalized, plan, warn } = writingContext;
  const { sizes } = normalized;
  const { context, ancestors, parts, names, initialName, partNames } = plan;
  const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('score-partwise', {
    version: '4.0',
  });

  if (document.header.title) {
    add(add(root, 'work'), 'work-title', document.header.title);
  }

  const identification = add(root, 'identification');

  for (const [key, role] of [
    ['composer', 'composer'],
    ['arranger', 'arranger'],
    ['poet', 'lyricist'],
  ] as const) {
    if (document.header[key]) {
      add(identification, 'creator', document.header[key], { type: role });
    }
  }

  if (document.header.copyright) {
    add(identification, 'rights', document.header.copyright);
  }

  add(add(identification, 'encoding'), 'software', 'lilypond-2-xml');
  const miscellaneous = add(identification, 'miscellaneous');

  add(miscellaneous, 'miscellaneous-field', JSON.stringify(document), {
    name: 'lilypond-event-document',
  });

  if (options.source !== undefined) {
    add(miscellaneous, 'miscellaneous-field', options.source, {
      name: 'lilypond-source',
    });
  }

  if (options.files) {
    const files = Object.fromEntries(
      Object.entries(options.files).map(([name, bytes]) => [
        name,
        typeof bytes === 'string' ? { text: bytes } : { bytes: Array.from(bytes) },
      ]),
    );

    add(miscellaneous, 'miscellaneous-field', JSON.stringify(files), {
      name: 'lilypond-includes',
    });
  }

  const pageSettings = writePaper(root, document.paper, warn);

  writeSizeDefaults(root, sizes.defaults, add);
  writeHeaderCredits(root, document, pageSettings, add, warn);
  const partList = add(root, 'part-list');
  const groups = document.contexts
    .filter((c) => ['StaffGroup', 'ChoirStaff'].includes(c.type))
    .map((c, i) => {
      const indices = parts.flatMap((p, index) =>
        p.staves.some((id) => ancestors(id).some((a) => a.id === c.id)) ? [index] : [],
      );

      return {
        ...c,
        number: i + 1,
        first: indices[0],
        last: indices.at(-1),
        depth: ancestors(c.id).length,
      };
    })
    .filter((g) => g.first !== undefined);

  for (const [index, part] of parts.entries()) {
    for (const group of groups.filter((g) => g.first === index).sort((a, b) => a.depth - b.depth)) {
      const node = add(partList, 'part-group', undefined, {
        type: 'start',
        number: group.number,
      });
      const series = names.get(group.id) || [];

      writeInitialNames(node, 'group', initialName(series), '', add, warn);

      if (
        series.some(
          (e) => eventTime(e) > 0 && shortNameKey(e) !== shortNameKey(initialName(series)),
        )
      ) {
        warn(
          'group-name-change',
          'Timed staff-group abbreviation changes have no mapped measure-level group display element; the initial group label and change history are retained.',
        );
      }

      add(node, 'group-symbol', 'bracket');
      add(node, 'group-barline', group.type === 'ChoirStaff' ? 'no' : 'yes');
    }

    const node = add(partList, 'score-part', undefined, { id: part.id });
    const fallback = context.get(part.contextId)?.name;

    writeInitialNames(
      node,
      'part',
      initialName(partNames.get(part.id)),
      fallback && fallback !== '\\new' ? fallback : 'Music',
      add,
      warn,
    );

    for (const drum of part.percussion) {
      add(
        add(node, 'score-instrument', undefined, { id: drum.instrumentId }),
        'instrument-name',
        drum.drumType,
      );
    }

    for (const group of groups.filter((g) => g.last === index).sort((a, b) => b.depth - a.depth)) {
      add(partList, 'part-group', undefined, {
        type: 'stop',
        number: group.number,
      });
    }
  }

  const layout = createLayoutSession(writingContext, pageSettings);

  for (const part of parts) {
    writePart(writingContext, layout, root, part);
  }

  const written = { root, miscellaneous, partList, pageSettings, layout };

  return written;
}

export type WrittenScore = ReturnType<typeof writeScore>;
