import type { MusicXMLOptions, MusicXMLResult } from './types.js';
import { normalizeScore } from './planning/normalize.js';
import { planScore } from './planning/score.js';
import type { Diagnostic } from '../model/diagnostics.js';
import type { ScoreDocument } from '../model/document.js';
import { finalizeScore } from './writing/finalize.js';
import { writeScore } from './writing/score.js';

export function toMusicXML(document: ScoreDocument, options: MusicXMLOptions = {}): MusicXMLResult {
  if (document?.version !== 1 || !Array.isArray(document.events)) {
    throw new TypeError('Expected a version 1 LilyPond event document');
  }

  const diagnostics: Diagnostic[] = [];
  const warn = (code: string, message: string) => {
    if (!diagnostics.some((d) => d.code === code && d.message === message)) {
      diagnostics.push({ code, message });
    }
  };

  for (const diagnostic of options.diagnostics ?? []) {
    warn(diagnostic.code, diagnostic.message);
  }

  const normalized = normalizeScore(document, warn);
  const plan = planScore(document, normalized, warn);
  const writingContext = { document, options, normalized, plan, warn };
  const written = writeScore(writingContext);
  const { root } = written;

  finalizeScore(writingContext, written);

  return { musicxml: root.end({ prettyPrint: true }), diagnostics };
}
