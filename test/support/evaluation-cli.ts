import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

export const script = fileURLToPath(new URL('../../tools/evaluation/cli.ts', import.meta.url));
export const loader = createRequire(import.meta.url).resolve('tsx/esm');
export const xml = (pitch: string) =>
  `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>${pitch}</step><octave>4</octave></pitch><duration>480</duration><type>quarter</type></note></measure></part></score-partwise>`;

export async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'evaluation-cli-test-'));

  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.ly'),
    musicxml = path.join(directory, 'score.musicxml');
  const reference = path.join(directory, 'native.mid');

  await writeFile(source, "{ c'4 }");
  await writeFile(musicxml, xml('C'));
  await writeFile(
    reference,
    new Uint8Array([
      77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, 13, 0, 144, 60,
      80, 131, 96, 128, 60, 0, 0, 255, 47, 0,
    ]),
  );
  const run = (name: string, extra: string[] = []) =>
    spawnSync(
      process.execPath,
      [
        '--import',
        loader,
        script,
        source,
        '--score',
        '1',
        '--reference',
        reference,
        '--musicxml',
        musicxml,
        '--out-dir',
        path.join(directory, name),
        ...extra,
      ],
      { cwd: directory, encoding: 'utf8', timeout: 30_000 },
    );
  const report = async (name: string) =>
    JSON.parse(await readFile(path.join(directory, name, 'results.json'), 'utf8'));

  return { directory, source, musicxml, run, report };
}
