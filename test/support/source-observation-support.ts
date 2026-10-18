import type { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import listener from '../../dist/lilypond/generated/listener.js';

export const callbackLogs = (logs: readonly string[], prefixes: readonly string[]) =>
  logs.filter((line) => prefixes.some((prefix) => line.startsWith(prefix)));

/** Compare an independent render with the notation observer in the same compiler. */
export async function compileObserver(
  compiler: Pick<ReturnType<typeof createReusableCompiler>, 'compile'>,
  source: string,
  callbackPrefixes: readonly string[],
) {
  const baseline = await compiler.compile(source, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(source, {
    format: ['svg', 'midi'],
    files: { 'source-observer.ily': listener },
    includeSettings: 'source-observer.ily',
  });
  const svgNames = (files: Record<string, Uint8Array>) =>
    Object.keys(files)
      .filter((name) => name.endsWith('.svg'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const names = svgNames(baseline.files);

  assert.ok(names.length > 0, 'independent rendering emits source SVG');
  assert.deepEqual(svgNames(observed.files), names, 'source SVG files remain unchanged');

  for (const name of names) {
    assert.deepEqual(
      observed.files[name],
      baseline.files[name],
      `actual source SVG ${name} stays byte-identical`,
    );
  }

  assert.ok(
    Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  assert.deepEqual(
    callbackLogs(observed.logs, callbackPrefixes),
    callbackLogs(baseline.logs, callbackPrefixes),
    'source callback order and count remain unchanged',
  );
  const svgs = names.map((name) => [name, baseline.files[name]!] as const);

  return { baseline, observed, svgs };
}
