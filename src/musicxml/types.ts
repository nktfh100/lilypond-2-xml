import type { Diagnostic } from '../model/diagnostics.js';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';

export interface MusicXMLResult {
  musicxml: string;
  diagnostics: Diagnostic[];
}

export type Attributes = Record<string, string | number | undefined>;
export type Add = (
  parent: XMLBuilder,
  name: string,
  text?: string | number | boolean | null,
  attrs?: Attributes,
) => XMLBuilder;
export type Notation = (hidden?: boolean) => XMLBuilder;

export type MusicXMLOptions = {
  files?: Readonly<Record<string, string | Uint8Array>>;
  source?: string;
  diagnostics?: readonly Diagnostic[];
};
