import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Part } from '../../planning/parts.js';
import type { LayoutSession } from '../layout-session.js';
import { finalizePart } from './finalization.js';
import { writeMeasure } from '../measure/write.js';
import { preparePart, createPartSession } from './session.js';
import type { ScoreWritingContext } from '../../context.js';
import { add } from '../../primitives.js';

export function writePart(
  writingContext: ScoreWritingContext,
  layout: LayoutSession,
  root: XMLBuilder,
  part: Part,
) {
  const { anchors } = layout;

  const { warn } = writingContext;

  const prepared = preparePart(writingContext, layout, part);

  for (const update of prepared.deferredNameUpdates) {
    layout.deferredNameUpdates.add(update);
  }

  const partNode = add(root, 'part', undefined, { id: part.id });
  const session = createPartSession(writingContext, part, prepared, partNode);
  const writer = { score: writingContext, layout, session, part };
  const { boundaries, tupletGapSpans } = session.plan;

  const { tiePlayback } = session.notation;

  for (let measureIndex = 0; measureIndex < boundaries.length; measureIndex++) {
    writeMeasure(writer, measureIndex);
  }

  finalizePart(partNode, {
    tupletGapSpans,
    replaceNode: anchors.replaceNode,
    tiePlayback,
    warn,
  });
}
