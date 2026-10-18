import type { Event } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import type { ClusterGraphicEvent } from '../../../model/document.js';

export function clusterHeads(events: Event[], warn: Warn): Map<number, ClusterGraphicEvent> {
  const result = new Map<number, ClusterGraphicEvent>();
  const conflicts = new Set<number>();

  for (const event of events) {
    if (event.kind === 'clusterGraphic') {
      for (const id of event.noteIds) {
        if (conflicts.has(id)) {
          continue;
        }

        if (result.has(id)) {
          result.delete(id);
          conflicts.add(id);
          warn(
            'cluster-ownership',
            'A cluster note belongs to multiple captured graphics. Its source ownership remains in metadata; a single exact native drawing is not established.',
          );
          continue;
        }

        result.set(id, event);
      }

      if (event.present && !event.hidden) {
        warn(
          'cluster-layout',
          "Native cluster noteheads retain the written pitches and durations. LilyPond's continuous filled ClusterSpanner envelope, padding and ramp or stair geometry between source columns are not reconstructed by native clusters at separate onsets.",
        );
      }

      if (event.custom) {
        warn(
          'cluster-stencil',
          'A custom or late cluster drawing retains its available native cluster heads. Arbitrary drawing and callback changes remain in source metadata.',
        );
      }
    }
  }

  for (const note of events) {
    if (note.kind === 'note' && note.cluster) {
      if (typeof note.noteId !== 'number' || !result.has(note.noteId)) {
        warn(
          'cluster-history',
          'A cluster note lacks actual ClusterSpanner and Beacon capture. Its available written data remains without a verified visible native cluster head.',
        );
      }
    }
  }

  return result;
}
