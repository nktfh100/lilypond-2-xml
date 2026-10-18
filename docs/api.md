# API reference

Convert LilyPond source into MusicXML 4.0 in Node.js or the browser. Import functions
and types from `lilypond-2-xml`. The package uses ES modules and includes TypeScript
declarations.

| Function or method                                                       | Use it to                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [`convert(source, options?)`](#convertsource-options)                    | Convert once, with automatic cleanup.                        |
| [`createConverter()`](#createconverter)                                  | Reuse a compiler for several conversions.                    |
| [`converter.convert(source, options?)`](#converterconvertsource-options) | Convert with a reusable compiler.                            |
| [`converter.preload(options?)`](#converterpreloadoptions)                | Load the compiler ahead of time and report loading progress. |
| [`converter.dispose()`](#converterdispose)                               | Release a reusable compiler when finished.                   |
| [`toMusicXML(document, options?)`](#tomusicxmldocument-options)          | Write MusicXML from an existing score document.              |

## `convert(source, options?)`

**Returns:** `Promise<ConversionResult>`.

Compiles a nonempty LilyPond source string and converts its printed scores. Uses
LilyPond 2.26.0 through WebAssembly; a native LilyPond installation is not required.
The compiler loads automatically and is disposed after success or failure.

```ts
import { convert } from 'lilypond-2-xml';

const source = String.raw`\version "2.26.0"
\relative c' { c4 d e f | g1 }
`;
const { scores, logs } = await convert(source);

for (const { filename, musicxml, diagnostics } of scores) {
  console.log(filename, musicxml);
  console.log(diagnostics);
}

console.log(logs);
```

A source can produce multiple scores. Each result contains MusicXML as a string;
the library does not save files or start browser downloads. Only printed scores are
returned. A source containing only MIDI output rejects with an error.

See [conversion options](#conversionoptions), [results](#results), and
[errors and cancellation](#errors-and-cancellation).

## `createConverter()`

**Returns:** `Converter` immediately. Takes no arguments.

Creates a reusable compiler. Loading starts on the first `convert()` or `preload()`
call. The worker and loaded runtime assets are reused, avoiding repeated setup.
Compiler jobs on the same converter run one at a time.

Call `dispose()` in a `finally` block after awaiting your conversions:

```ts
import { createConverter } from 'lilypond-2-xml';

const converter = createConverter();
const sources = [String.raw`{ c'4 d' e' f' }`, String.raw`{ g'1 }`];

try {
  for (const source of sources) {
    const { scores } = await converter.convert(source);
    console.log(scores.map((score) => score.musicxml));
  }
} finally {
  converter.dispose();
}
```

## `converter.convert(source, options?)`

**Returns:** `Promise<ConversionResult>`.

Accepts the same source and [options](#conversionoptions), and returns the same
[results](#results), as the standalone `convert()` function. It keeps the compiler
available for the next call instead of disposing it.

Each compilation has a fresh in-memory filesystem. Pass any included files on
every call; files from an earlier conversion are not retained. After disposal,
conversion calls reject.

## `converter.preload(options?)`

**Returns:** `Promise<void>`.

Loads and prepares the WebAssembly compiler and runtime assets without converting
a score. It is optional: `convert()` loads them when needed. Preloading shares the
compiler's queue with conversions. When assets are already loaded, they are reused.

### `PreloadOptions`

All properties are optional.

| Property     | Type                                   | Default | Meaning                                                                            |
| ------------ | -------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `signal`     | `AbortSignal`                          | None    | Cancel loading. See [cancellation](#errors-and-cancellation).                      |
| `onProgress` | `(progress: DownloadProgress) => void` | None    | Receive runtime asset loading progress. Not called when assets are already loaded. |

`DownloadProgress` contains `loadedBytes` and `totalBytes`, both numbers. Progress
describes asset loading, not score conversion. Await `preload()` to know that
preparation has finished; reaching the byte total alone does not mean it is ready.

```ts
import { createConverter } from 'lilypond-2-xml';

const converter = createConverter();

try {
  await converter.preload({
    onProgress: ({ loadedBytes, totalBytes }) => {
      if (totalBytes > 0) {
        console.log(`${Math.round((loadedBytes / totalBytes) * 100)}% loaded`);
      }
    },
  });

  const { scores } = await converter.convert(String.raw`{ c'1 }`);
  console.log(scores);
} finally {
  converter.dispose();
}
```

Loading or cancellation errors reject the promise. Calling `preload()` after
disposal also rejects.

## `converter.dispose()`

**Returns:** `void`. Takes no arguments.

Terminates an active worker and releases its runtime assets, causing its compiler
job to reject. Disposal during worker startup can be missed; see the
[startup limitation](#errors-and-cancellation) below. Queued and future compiler
jobs reject. Calling `dispose()` more than once is safe. A disposed converter
cannot be reused; create a new one.

Await conversions before disposing when you want their results. The standalone
`convert()` function handles disposal for you.

## `ConversionOptions`

These options apply to both conversion functions. All properties are optional.

| Property       | Type                                             | Default      | Meaning                                                                                                     |
| -------------- | ------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `filename`     | `string`                                         | `'score.ly'` | Filename assigned to the main source inside the compiler. Use each result's `filename` for the output name. |
| `files`        | `Readonly<Record<string, string \| Uint8Array>>` | `{}`         | Additional input files, keyed by relative filename. Use strings for text or byte arrays for file contents.  |
| `includePaths` | `readonly string[]`                              | `[]`         | Additional relative directories to search for LilyPond includes.                                            |
| `signal`       | `AbortSignal`                                    | None         | Cancel compilation.                                                                                         |
| `onLog`        | `(text: string) => void`                         | None         | Receive compiler output as it arrives. Successful results also contain `logs`.                              |

Paths refer to the compiler's in-memory files, not your computer's filesystem or
URLs. Supply external file contents through `files`, including in Node.js.
Use forward slashes for directories. Paths must be nonempty and relative, with no
empty, `.` or `..` segments, backslashes, or null characters.

Avoid using the main source filename as a `files` key: the source takes precedence.
The filename `__musicxml_events.ily` is reserved for the converter.

### Included files

```ts
import { convert, type ConversionOptions } from 'lilypond-2-xml';

const options: ConversionOptions = {
  filename: 'piece.ly',
  files: {
    'parts/melody.ily': 'melody = { c4 d e f | g1 }',
  },
  includePaths: ['parts'],
  onLog: (text) => console.log(text),
};

const { scores } = await convert(
  String.raw`\version "2.26.0"
\include "melody.ily"
\relative c' { \melody }
`,
  options,
);

console.log(scores);
```

## Results

### `ConversionResult`

| Property | Type                | Meaning                                                                                     |
| -------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `scores` | `ConvertedScore[]`  | One entry per converted printed score. A successful conversion contains at least one entry. |
| `logs`   | `readonly string[]` | Compiler messages from the successful compilation.                                          |

Scores are sorted by output filename using numeric ordering. Use their returned
filenames instead of assuming a naming pattern.

### `ConvertedScore`

| Property      | Type            | Meaning                                                                   |
| ------------- | --------------- | ------------------------------------------------------------------------- |
| `filename`    | `string`        | Output filename ending in `.musicxml`.                                    |
| `musicxml`    | `string`        | Formatted MusicXML 4.0 with a `score-partwise` root.                      |
| `diagnostics` | `Diagnostic[]`  | Conversion limitations or substitutions.                                  |
| `document`    | `ScoreDocument` | Structured score data captured from LilyPond, usable with `toMusicXML()`. |

### `Diagnostic`

Each diagnostic has a `code: string` and a `message: string`. A diagnostic does not
mean the conversion failed. Review the messages to understand what was omitted or
approximated in the exported MusicXML. Exact engraving, layout, and rich markup
are not always preserved. Reader compatibility is checked separately in developer
tests and evaluation tools.

The same score can contain several diagnostics. Display their messages to users;
use codes when your application needs special handling. Allow for codes you have
not seen before.

### Embedded metadata

`convert()` and `converter.convert()` embed the score document, original source,
and any supplied files in each score's MusicXML metadata. All supplied files are included,
even those the score did not use. Text files remain text; byte arrays are stored as
JSON arrays of numbers. This metadata travels with the MusicXML when it is shared.

Diagnostics are returned separately and are not embedded in the MusicXML.

## Errors and cancellation

`convert()`, `converter.convert()`, and `converter.preload()` report failures by
rejecting their promises. Handle them with `try/catch`.

| Situation                                                                     | Behavior                                                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Empty, whitespace-only, or non-string source                                  | Conversion rejects with `TypeError`.                                                                                                  |
| Invalid paths, missing includes, invalid LilyPond, or runtime loading failure | Conversion rejects with an error describing the failure.                                                                              |
| No printed scores                                                             | Conversion rejects, including for MIDI-only input.                                                                                    |
| Unreadable compiler event data                                                | Conversion rejects with an error naming the event file; its `cause` holds the decoding error.                                         |
| Disposed converter                                                            | New compiler jobs reject with an error.                                                                                               |
| Aborted signal                                                                | When cancellation is observed, the operation rejects with `signal.reason`, or an `AbortError` if the reason is `null` or `undefined`. |

An error returned by LilyPond with a nonzero exit status has the name
`LilyPondCompileError`, an `exitCode`, and `logs`. This error class is not re-exported
by this package. Other failures may be ordinary errors; do not assume every error
has compiler logs.

When cancellation is observed, it terminates the active worker. A reusable
converter can run another conversion afterward, loading a new worker as needed.
An already-aborted signal prevents its compiler job from starting. A queued job
observes cancellation when its turn arrives. Cancellation does not interrupt the
synchronous MusicXML writing step after compilation.

**Known startup limitation:** with the current compiler dependency
(`@sightread/lilypond-wasm` 0.2.0), cancellation or disposal during initial worker
startup can be missed in Node.js. The pending preload or conversion may still
complete successfully. This is a dependency bug; cancellation and disposal do not
guarantee rejection during that startup window.

This example applies a timeout. A browser cancel button can call the same
`controller.abort()` method:

```ts
import { convert } from 'lilypond-2-xml';

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);

try {
  const { scores } = await convert(String.raw`{ c'1 }`, {
    signal: controller.signal,
  });
  console.log(scores);
} catch (error) {
  if (controller.signal.aborted) {
    console.log('Conversion cancelled');
  } else {
    throw error;
  }
} finally {
  clearTimeout(timeout);
}
```

## `toMusicXML(document, options?)`

**Returns:** `MusicXMLResult` synchronously: `{ musicxml, diagnostics }`.

Writes MusicXML from an existing `ScoreDocument`, without running the LilyPond
compiler. Use the `document` returned by a previous conversion. This is an advanced
API; ordinary source conversion only needs `convert()`.

The document must have `version: 1`, an `events` array, and the remaining fields
required by `ScoreDocument`. An unsupported version or missing event array throws
`TypeError`. The function does not fully validate arbitrary input; other malformed
document fields can also throw.

### `MusicXMLOptions`

All properties are optional. These options affect output metadata and diagnostics;
they do not compile additional source or files.

| Property      | Type                                             | Default | Meaning                                                                                                            |
| ------------- | ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `source`      | `string`                                         | Omitted | Original LilyPond text to embed in the MusicXML.                                                                   |
| `files`       | `Readonly<Record<string, string \| Uint8Array>>` | Omitted | Input files to embed in the MusicXML.                                                                              |
| `diagnostics` | `readonly Diagnostic[]`                          | `[]`    | Existing diagnostics to combine with those produced during writing. Identical code/message pairs are deduplicated. |

The score document is always embedded. Source and files are embedded only when
provided; they are not recovered automatically from a previous conversion.
This function has no loading, cancellation, or disposal step.

```ts
import { convert, toMusicXML, type MusicXMLOptions } from 'lilypond-2-xml';

const source = String.raw`{ c'4 d' e' f' }`;
const { scores } = await convert(source);
const score = scores[0];

if (!score) {
  throw new Error('Expected a converted score');
}

const options: MusicXMLOptions = {
  source,
  diagnostics: score.diagnostics,
};
const { musicxml, diagnostics } = toMusicXML(score.document, options);

console.log(musicxml, diagnostics);
```

## TypeScript types

Import public types from the package root with `import type`:

```ts
import type {
  ConversionOptions,
  ConversionResult,
  ConvertedScore,
  Converter,
  Diagnostic,
  DownloadProgress,
  MusicXMLOptions,
  MusicXMLResult,
  PreloadOptions,
  ScoreDocument,
} from 'lilypond-2-xml';
```

Additional score model types are exported for inspecting `ScoreDocument`. Their
field definitions are available in [the score model](../src/model/document.ts)
and in your editor through the package's TypeScript declarations.
