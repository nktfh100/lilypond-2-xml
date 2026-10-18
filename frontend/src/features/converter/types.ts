import type { Diagnostic } from '@converter';

export interface SourceInput {
  source: string;
  filename: string;
  files: Record<string, string>;
}

export interface ConvertedScore {
  sourceIndex: number;
  filename: string;
  musicxml: string;
  diagnostics: Diagnostic[];
}

export interface ConversionOutput {
  scores: ConvertedScore[];
  logs: readonly string[];
}

export interface ConversionProgress {
  label: string;
  percent?: number;
}

export type ConversionState =
  | { status: 'idle' }
  | { status: 'running'; progress: ConversionProgress }
  | { status: 'success'; output: ConversionOutput }
  | { status: 'error'; message: string };
