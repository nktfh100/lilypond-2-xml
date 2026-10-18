import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { reduceMeasureDivisions } from '../../postprocess/divisions.js';
import { completeImplicitTuplets } from '../../postprocess/implicit-tuplets.js';
import type { Warn } from '../../../model/diagnostics.js';
import { add } from '../../primitives.js';
import { anchorOctaveDirections } from '../../postprocess/octave-directions.js';
import { completeTupletContinuations } from '../../postprocess/tuplet-continuations.js';
import { completeTupletGapStops } from '../../postprocess/tuplet-gap-stops.js';
import type { NativeAnchors } from '../native-anchors.js';
import type { TiePlaybackSession } from '../tie-session.js';

interface PartCompletion {
  readonly tupletGapSpans: Parameters<typeof completeTupletGapStops>[1];
  readonly replaceNode: NativeAnchors['replaceNode'];
  readonly tiePlayback: Pick<TiePlaybackSession, 'discardUnresolved'>;
  readonly warn: Warn;
}

/** Complete the whole-part passes before score page and label completion. */
export function finalizePart(
  partNode: XMLBuilder,
  { tupletGapSpans, replaceNode, tiePlayback, warn }: PartCompletion,
) {
  completeTupletGapStops(partNode, tupletGapSpans, add, replaceNode);
  completeImplicitTuplets(partNode, add);
  completeTupletContinuations(partNode, add);
  anchorOctaveDirections(partNode);

  if (
    partNode.find(
      (node) => node.node.nodeName === 'offset' && Math.abs(Number(node.node.textContent)) > 32767,
      false,
      true,
    )
  ) {
    reduceMeasureDivisions(partNode, add);
  }

  if (tiePlayback.discardUnresolved()) {
    warn(
      'tie-playback-unresolved',
      'A source tie has no matching performed endpoint in this part; the unpaired sound link is omitted while written pitches and durations are retained.',
    );
  }
}
