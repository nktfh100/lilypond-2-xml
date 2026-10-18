# lilypond-2-xml

Nearly lossless LilyPond to MusicXML conversion for Node.js and the browser.

## Install

```sh
npm install lilypond-2-xml
```

For Node.js, use version 20.11+

## Usage

```ts
import { convert } from 'lilypond-2-xml';

const { scores } = await convert(String.raw`\version "2.26.0"
\relative c' { c4 d e f | g1 }
`);

for (const { musicxml, diagnostics } of scores) {
  console.log(musicxml, diagnostics);
}
```

For repeated conversions, reuse a converter from `createConverter()` and call `dispose()`
when you're done. You can load the compiler ahead of time with `await converter.preload()`.

Pass included files through the `files` option, or an abort `signal` to cancel a conversion.

See the [API reference](docs/api.md) for more.

## Browser setup

Use the same API in the browser. For Vite, add these settings to `vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'esnext' },
  worker: { format: 'es' },
});
```

The browser loads about 31 MB of compiler files on first use.

## Support & limitations

The converter uses LilyPond 2.26.0. MIDI-only scores aren't supported.

Engraving overrides, page layout, and rich markup may not carry over exactly.
Check `diagnostics` for details about your score.

## Evaluator

The evaluator compares converted notes and playback with native LilyPond.
Run it from this repository after `npm ci`, with LilyPond 2.26.0 installed.

```sh
npm run evaluate -- score.ly
```

It prints a summary to the console and saves detailed results in a temporary directory.

Run `npm run evaluate -- --help` for options, including how to set the LilyPond executable path.

## Tests

Tests cover conversion, MusicXML validation, Verovio compatibility, browsers, and native LilyPond.

```sh
npm ci
npm run test:coverage     # Node.js tests + coverage/index.html
npx playwright install chromium
npm run test:browser
LILYPOND_BIN=lilypond npm run test:native  # Requires LilyPond 2.26.0
```

Coverage measures library code, excluding types, generated code, WebAssembly, and browser runs.

## Dependencies

- `@sightread/lilypond-wasm` runs LilyPond through WebAssembly.
- `@sightread/lilypond-eventdocument` captures score data, with [our listener extensions](patches/).
- `xmlbuilder2` builds the MusicXML output.

## Releases

Pushing a version tag runs the release checks, tests a fresh package installation,
and publishes the tested package to npm. Stable versions use `latest`; prerelease
versions use `next`.

Configure this once in the package's [npm settings](https://www.npmjs.com/package/lilypond-2-xml/access),
under **Trusted Publisher**, selecting **GitHub Actions**:

| Setting              | Value                                       |
| -------------------- | ------------------------------------------- |
| Organization or user | `nktfh100`                                  |
| Repository           | `lilypond-2-xml`                            |
| Workflow filename    | `publish.yml`                               |
| Environment name     | Leave empty                                 |
| Allowed actions      | Enable direct publishing with `npm publish` |

The workflow uses short-lived credentials from GitHub, so no `NPM_TOKEN` secret is
needed. Public repositories also publish provenance. See
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

Commit the workflow and your release changes before running:

```sh
npm version patch -m "Release v%s"
git push origin HEAD --follow-tags
```

Use `npm version minor` or `npm version major` for larger releases. The tag must
match the version in `package.json`. Check the **Publish to npm** workflow in
GitHub Actions for the result. Publishing requires the Trusted Publisher settings
above and a public repository for provenance.
