import type { ScoreDocument } from '../model/document.js';
import type { MusicXMLResult } from '../musicxml/types.js';

export interface DownloadProgress {
  readonly loadedBytes: number;
  readonly totalBytes: number;
}
export interface PreloadOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: DownloadProgress) => void;
}
export interface ConversionOptions {
  filename?: string;
  files?: Readonly<Record<string, string | Uint8Array>>;
  includePaths?: readonly string[];
  signal?: AbortSignal;
  onLog?: (text: string) => void;
}
export interface ConvertedScore extends MusicXMLResult {
  filename: string;
  document: ScoreDocument;
}
export interface ConversionResult {
  scores: ConvertedScore[];
  logs: readonly string[];
}
export interface Converter {
  preload(options?: PreloadOptions): Promise<void>;
  convert(source: string, options?: ConversionOptions): Promise<ConversionResult>;
  dispose(): void;
}
