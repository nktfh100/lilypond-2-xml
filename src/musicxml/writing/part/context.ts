import type { ScoreWritingContext } from '../../context.js';
import type { Part } from '../../planning/parts.js';
import type { LayoutSession } from '../layout-session.js';
import type { PartSession } from './session.js';

/** Immutable score inputs and one part's explicitly owned writing state. */
export interface PartWriterContext {
  readonly score: ScoreWritingContext;
  readonly layout: LayoutSession;
  readonly session: PartSession;
  readonly part: Part;
}
