import { LISTENER_PATH } from '@sightread/lilypond-eventdocument/node';
import { readFileSync, writeFileSync } from 'node:fs';

const listenerRoot = new URL('../src/lilypond/listener/', import.meta.url);
const listenerFiles = [
  'score/transposition.ily',
  'lifecycle/score-state.ily',
  'score/directions.ily',
  'score/timing.ily',
  'notation/percussion.ily',
  'notation/noteheads.ily',
  'notation/sizes.ily',
  'score/quotes.ily',
  'notation/ornaments.ily',
  'notation/breaths.ily',
  'notation/arpeggios.ily',
  'notation/techniques.ily',
  'notation/brackets.ily',
  'shared/curve-stencils.ily',
  'notation/slurs.ily',
  'notation/glissandi.ily',
  'notation/ties.ily',
  'notation/tablature.ily',
  'notation/harmony.ily',
  'notation/figured-bass.ily',
  'layout/paper.ily',
  'shared/markup.ily',
  'text/headers.ily',
  'shared/geometry.ily',
  'text/names.ily',
  'text/text-columns.ily',
  'notation/clusters.ily',
  'notation/duration-lines.ily',
  'notation/ligatures.ily',
  'shared/line-geometry.ily',
  'notation/finger-glides.ily',
  'notation/episemas.ily',
  'notation/optional-material.ily',
  'notation/bends.ily',
  'text/measure-counters.ily',
  'text/footnotes.ily',
  'text/lyric-extenders.ily',
  'text/combine-text.ily',
  'text/vowel-transitions.ily',
  'text/labels.ily',
  'layout/note-positions.ily',
  'layout/measure-layout.ily',
  'notation/accidentals.ily',
  'lifecycle/final-layout.ily',
  'layout/measures.ily',
  'score/percent.ily',
  'score/navigation.ily',
  'score/repeat-ownership.ily',
  'layout/page-layout.ily',
  'layout/page-credits.ily',
  'lifecycle/mensural-contexts.ily',
  'lifecycle/normal-book.ily',
];

const listener = [
  readFileSync(LISTENER_PATH, 'utf8'),
  ...listenerFiles.map((file) => readFileSync(new URL(file, listenerRoot), 'utf8')),
].join('');
const target = new URL('../src/lilypond/generated/listener.ts', import.meta.url);
const generated = `const listener: string = ${JSON.stringify(listener)};\nexport default listener;\n`;

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== generated) {
    throw new Error('Generated listener is stale. Run npm run build:listener.');
  }
} else {
  writeFileSync(target, generated);
}
