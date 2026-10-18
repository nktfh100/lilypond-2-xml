import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { evaluationNotes } from './playback.js';
import { evaluationHelp, parseEvaluationOptions } from './evaluation-options.js';
import {
  buildEvaluationReport,
  evaluationMetadata,
  formatEvaluationReport,
  type ScoreFile,
  type ScoreReference,
  type ScoreEvaluation,
} from './evaluation-report.js';

import { evaluateScore } from './evaluation-score.js';

const script = fileURLToPath(import.meta.url);
const loader = createRequire(import.meta.url).resolve('tsx/esm');

async function collectFiles(root: string, directory = root): Promise<Record<string, string>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries
      .filter((entry) => !['.git', 'node_modules'].includes(entry.name))
      .map(async (entry) => {
        const filename = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          return collectFiles(root, filename);
        }

        return entry.isFile() && /\.(ly|ily|scm)$/.test(entry.name)
          ? {
              [path.relative(root, filename).split(path.sep).join('/')]: await readFile(
                filename,
                'utf8',
              ),
            }
          : {};
      }),
  );

  return Object.assign({}, ...groups) as Record<string, string>;
}

async function worker(mode: string, args: string[]) {
  if (mode === 'convert') {
    const [input, root, directory] = args as [string, string, string];
    const { createConverter } = await import('../../src/index.js');
    const converter = createConverter();

    try {
      const filename = path.relative(root, input).split(path.sep).join('/');
      const files = await collectFiles(root);
      const result = await converter.convert(await readFile(input, 'utf8'), {
        filename,
        files,
        includePaths: [path.posix.dirname(filename)].filter((name) => name !== '.'),
        onLog: (text) => process.stderr.write(`${text}\n`),
      });
      const scores: ScoreFile[] = [];

      for (const score of result.scores) {
        const index = Number(/score\.(\d+)\.musicxml$/.exec(score.filename)?.[1]);

        if (!Number.isSafeInteger(index) || index < 1) {
          throw new Error(`Cannot identify source score: ${score.filename}`);
        }

        const xml = path.join(directory, `score-${index}.musicxml`);

        await writeFile(xml, score.musicxml);
        await writeFile(
          path.join(directory, `score-${index}.diagnostics.json`),
          JSON.stringify(score.diagnostics, null, 2),
        );

        if (score.document.layoutRequested === false) {
          throw new Error('Converter returned a MIDI-only score outside its supported scope');
        }

        scores.push({ index, xml, kind: 'printed' });
      }

      await writeFile(path.join(directory, 'exports.json'), JSON.stringify(scores, null, 2));
    } finally {
      converter.dispose();
    }
  } else if (mode === 'render') {
    const [input, output] = args as [string, string];
    const xml = await readFile(input, 'utf8');
    const { create } = await import('xmlbuilder2');

    if (!['score-partwise', 'score-timewise'].includes(create(xml).root().node.nodeName)) {
      throw new Error('Input is not a MusicXML score');
    }

    const { VerovioToolkit } = await import('verovio/esm');
    const { default: createModule } = await import('verovio/wasm');
    const toolkit = new VerovioToolkit(await createModule());

    try {
      toolkit.setOptions({ inputFrom: 'musicxml' });

      if (!toolkit.loadData(xml) || !toolkit.getPageCount()) {
        throw new Error('Verovio could not load this MusicXML');
      }

      const midi = Buffer.from(toolkit.renderToMIDI(), 'base64');

      evaluationNotes(midi);
      await writeFile(output, midi);
    } finally {
      toolkit.destroy();
    }
  } else {
    throw new Error(`Unknown worker mode: ${mode}`);
  }
}

async function main() {
  const options = parseEvaluationOptions(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(evaluationHelp);

    return;
  }

  const { source, root, selected, tolerance, timeout, minimum, minimumWritten } = options;
  const sourceSha256 = createHash('sha256')
    .update(await readFile(source))
    .digest('hex');
  const directory = options.directory
    ? options.directory
    : await mkdtemp(path.join(tmpdir(), 'lilypond-evaluation-'));

  await mkdir(directory, { recursive: true });

  const run = async (label: string, command: string, args: string[]) => {
    const log = path.join(directory, `${label}.log`);

    try {
      const result = await promisify(execFile)(command, args, {
        cwd: path.dirname(source),
        timeout,
        maxBuffer: 16 * 1024 * 1024,
      });

      await writeFile(log, result.stdout + result.stderr);

      return result.stdout + result.stderr;
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };

      await writeFile(
        log,
        (failure.stdout ?? '') + (failure.stderr ?? '') + `\n${failure.message}\n`,
      );
      throw new Error(`${label} failed or timed out; see ${log}`);
    }
  };
  const child = (mode: string, args: string[], label: string) =>
    run(label, process.execPath, ['--import', loader, script, '--worker', mode, ...args]);
  const metadata = evaluationMetadata(
    source,
    sourceSha256,
    root,
    tolerance,
    new Date().toISOString(),
  );

  try {
    let references: ScoreReference[];
    let nativeVersion: string | null = null;

    if (options.reference) {
      references = [
        {
          index: selected!,
          kind: 'unknown',
          midi: path.resolve(options.reference),
        },
      ];
    } else {
      nativeVersion = (await run('native-version', options.lilypond, ['--version'])).split(
        '\n',
      )[0]!;
      const prefix = path.join(directory, 'reference');
      const settings = fileURLToPath(
        new URL('./reference/evaluate-reference.ily', import.meta.url),
      );
      const wrapper = path.join(directory, 'native-reference.ly');
      const literal = (value: string) => JSON.stringify(value.split(path.sep).join('/'));

      await writeFile(
        wrapper,
        `\\version "2.26.0"\n#(define evaluation-output-prefix ${literal(prefix)})\n#(ly:set-option 'relative-includes #t)\n\\include ${literal(settings)}\n\\include ${literal(source)}\n`,
      );
      const log = await run('native', options.lilypond, [
        '-dno-print-pages',
        '-I',
        root,
        '-o',
        path.join(directory, 'native'),
        wrapper,
      ]);

      if (/programming error:/i.test(log)) {
        throw new Error(
          `Native reference reported an internal error; see ${path.join(directory, 'native.log')}`,
        );
      }

      const manifest = await readFile(`${prefix}.tsv`, 'utf8');

      references = manifest
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [index, kind] = line.split('\t');

          if (kind !== 'printed') {
            throw new Error('Invalid native reference manifest');
          }

          return {
            index: Number(index),
            kind,
            midi: `${prefix}-${index}.midi`,
            written: `${prefix}-${index}.written.tsv`,
          };
        });
    }

    let exports: ScoreFile[];

    if (options.musicxml) {
      exports = [
        {
          index: selected!,
          kind: 'unknown',
          xml: path.resolve(options.musicxml),
        },
      ];
    } else {
      await child('convert', [source, root, directory], 'conversion');
      exports = JSON.parse(
        await readFile(path.join(directory, 'exports.json'), 'utf8'),
      ) as ScoreFile[];
    }

    if (selected !== null) {
      references = references.filter((score) => score.index === selected);
      exports = exports.filter((score) => score.index === selected);
    }

    if (!references.length) {
      throw new Error('No matching native source score was found');
    }

    const scores: ScoreEvaluation[] = [];

    for (const reference of references) {
      const exported = exports.find((score) => score.index === reference.index);

      scores.push(
        await evaluateScore(reference, exported, directory, tolerance, {
          readText: (filename) => readFile(filename, 'utf8'),
          readMidi: (filename) => readFile(filename),
          render: (input, output, label) => child('render', [input, output], label),
        }),
      );
    }

    const { report, exitCode } = buildEvaluationReport({
      metadata,
      scores,
      references,
      exports,
      nativeVersion,
      suppliedReference: Boolean(options.reference),
      minimum,
      minimumWritten,
    });

    await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2));
    process.stdout.write(formatEvaluationReport(report, path.join(directory, 'results.json')));

    if (exitCode) {
      process.exitCode = exitCode;
    }
  } catch (error) {
    await writeFile(
      path.join(directory, 'results.json'),
      JSON.stringify(
        {
          ...metadata,
          status: 'failed',
          error: String(error),
          writtenSummary: null,
          playbackSummary: null,
          summary: null,
        },
        null,
        2,
      ),
    );
    throw error;
  }
}

try {
  if (process.argv[2] === '--worker') {
    await worker(process.argv[3]!, process.argv.slice(4));
  } else {
    await main();
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
