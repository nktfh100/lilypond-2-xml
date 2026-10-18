import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { compileWithPageBreakingFallback } from '../lilypond/compile-fallback.js';
import { decodeDocument } from '../lilypond/decode/document.js';
import listener from '../lilypond/generated/listener.js';
import { toMusicXML } from '../musicxml/convert.js';
import { sanitizeInput } from '../lilypond/sanitize.js';
import type { ConversionOptions, ConversionResult, Converter } from './types.js';
import type { RawDocument } from '../lilypond/wire.js';

const pageBreakingFallbackDiagnostic = {
  code: 'page-breaking-fallback',
  message:
    "LilyPond's optimal page breaker crashed; retried with minimal page " +
    'breaking. Page distribution may differ from the source.',
};

export function createConverter(): Converter {
  const compiler = createReusableCompiler();

  return {
    preload: (options) => compiler.preload(options),
    dispose: () => compiler.dispose(),
    async convert(source, options = {}) {
      if (typeof source !== 'string' || !source.trim()) {
        throw new TypeError('LilyPond source must be a nonempty string');
      }

      const sanitizedInput = sanitizeInput(source, options.files);
      const compileWith = (pageBreakingFallback: boolean) =>
        compiler.compile(sanitizedInput.source, {
          ...options,
          files: {
            ...options.files,
            ...sanitizedInput.files,
            '__musicxml_events.ily':
              listener +
              '\n#(set! xml-normal-write-pages #f)\n' +
              (pageBreakingFallback ? '#(set! xml-normal-page-breaking-fallback #t)\n' : ''),
          },
          includeSettings: '__musicxml_events.ily',
        });
      const { result, pageBreakingFallback } = await compileWithPageBreakingFallback(compileWith);
      const outputs = Object.entries(result.files)
        .filter(([name]) => name.endsWith('.events.json'))
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([name, bytes]) => {
          let document;

          try {
            const raw = JSON.parse(new TextDecoder().decode(bytes)) as RawDocument;

            document = decodeDocument(raw);
          } catch (cause) {
            throw new Error(`Unable to decode LilyPond event document ${name}`, { cause });
          }

          const converted = toMusicXML(document, {
            source,
            diagnostics: [
              ...sanitizedInput.diagnostics,
              ...(pageBreakingFallback ? [pageBreakingFallbackDiagnostic] : []),
            ],
            ...(options.files ? { files: options.files } : {}),
          });

          return {
            filename: name.replace('.events.json', '.musicxml'),
            document,
            musicxml: converted.musicxml,
            diagnostics: converted.diagnostics,
          };
        });

      if (!outputs.length) {
        throw new Error(
          'LilyPond produced no printed score documents; MIDI-only scores are not converted',
        );
      }

      return { scores: outputs, logs: result.logs };
    },
  };
}

export async function convert(
  source: string,
  options?: ConversionOptions,
): Promise<ConversionResult> {
  const converter = createConverter();

  try {
    return await converter.convert(source, options);
  } finally {
    converter.dispose();
  }
}
