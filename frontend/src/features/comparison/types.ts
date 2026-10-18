import type { EvaluationReference, ScoreAccuracy } from '@/features/evaluation/types';

export type ScorePreview = { pages: string[]; error?: never } | { pages?: never; error: string };

export interface ScoreRenderInput {
  musicxml: string;
  reference: EvaluationReference | undefined;
}

export interface RenderedScore {
  preview: ScorePreview;
  accuracy: ScoreAccuracy;
  logs: string[];
}

export interface RenderingOutput {
  original: ScorePreview;
  scores: RenderedScore[];
  logs: readonly string[];
}

export type RenderingState =
  | { status: 'running'; progress: string }
  | { status: 'success'; output: RenderingOutput }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };
