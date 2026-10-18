export interface EvaluationReference {
  written?: string;
  midi?: Uint8Array;
}

export interface ScoreAccuracy {
  notes: number | null;
  playback: number | null;
}
