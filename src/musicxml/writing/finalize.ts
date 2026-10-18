import type { ScoreWritingContext } from '../context.js';
import { completeScorePagesAndLabels } from './page-label-completion.js';
import { reportScoreDiagnostics } from './score-diagnostics.js';
import type { WrittenScore } from './score.js';

export function finalizeScore(context: ScoreWritingContext, written: WrittenScore) {
  completeScorePagesAndLabels(context, written);
  reportScoreDiagnostics(context);
}
