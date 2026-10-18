import type { Warn } from '../model/diagnostics.js';
import type { NormalizedScore } from './planning/normalize.js';
import type { ScorePlan } from './planning/score.js';
import type { ScoreDocument } from '../model/document.js';
import type { MusicXMLOptions } from './types.js';

/** Immutable inputs shared by XML writers. Mutable notation state belongs to each part. */
export interface ScoreWritingContext {
  readonly document: ScoreDocument;
  readonly options: MusicXMLOptions;
  readonly normalized: NormalizedScore;
  readonly plan: ScorePlan;
  readonly warn: Warn;
}
