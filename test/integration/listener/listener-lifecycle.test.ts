import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import listener from '../../../dist/lilypond/generated/listener.js';

type RawDocument = {
  contexts: { id: number; type: string; name: string }[];
  events: {
    k: string;
    c?: string;
    nid?: number;
    'repeat-context'?: number;
    a?: { c: string }[];
    status?: string;
  }[];
};
const readDocuments = (files: Record<string, Uint8Array>) =>
  Object.entries(files)
    .filter(([name]) => name.endsWith('.events.json'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bytes]) => JSON.parse(new TextDecoder().decode(bytes)) as RawDocument);

test('repeat observation preserves note articulations and collector state across scores and compiler reuse', async () => {
  const compiler = createReusableCompiler();
  const settings = {
    includeSettings: '__events.ily',
    files: {
      '__events.ily': listener + '\n#(set! xml-normal-write-pages #f)\n',
    },
  };

  try {
    const first = await compiler.compile(
      String.raw`
\score {
 \header { piece = \markup \score { { b'1 } \layout {} } }
 \new Staff \new Voice = "lead" {
  \repeat volta 2 { c'4\glide-1 d'4-1 e'4 f'4 }
  \alternative { { g'1 } { a'1 } }
 } \layout {}
}
\score { \new Staff \new Voice = "next" { d'1 } \layout {} }
`,
      settings,
    );
    const documents = readDocuments(first.files);

    assert.equal(documents.length, 2);
    const [repeated, next] = documents;

    assert(repeated && next);
    assert.equal(repeated.events.filter((event) => event.k === 'fingerglide').length, 1);
    assert(
      repeated.events
        .find((event) => event.k === 'note')
        ?.a?.some((event) => event.c === 'finger-glide-event'),
    );
    const repeats = repeated.events.filter(
      (event) => event.k === 'score' && event.c?.startsWith('volta-repeat-'),
    );

    assert(repeats.length >= 2);

    for (const event of repeats) {
      const owner: RawDocument['contexts'][number] | undefined = repeated.contexts.find(
        (context) => context.id === event['repeat-context'],
      );

      assert.equal(owner?.name, 'lead');
    }

    assert.equal(next.events.filter((event) => event.k === 'fingerglide').length, 0);
    assert.equal(next.events.find((event) => event.k === 'note')?.nid, 1);

    for (const document of documents) {
      assert.equal(document.events.find((event) => event.k === 'finallayout')?.status, 'complete');
    }

    const reused = readDocuments(
      (await compiler.compile(String.raw`\score { { e'1 } \layout {} }`, settings)).files,
    );

    assert.equal(reused.length, 1);
    const [reusedScore] = reused;

    assert(reusedScore);
    assert.equal(reusedScore.events.filter((event) => event.k === 'fingerglide').length, 0);
    assert.equal(reusedScore.events.find((event) => event.k === 'note')?.nid, 1);
  } finally {
    compiler.dispose();
  }
});

test('collector snapshots retain table identity and reject duplicate state ownership', async () => {
  const compiler = createReusableCompiler();

  try {
    const probe = String.raw`
#(let ((snapshot (xml-save-score-state)) (original ed-context-table))
 (xml-reset-semantic-state!)
 (when (eq? original ed-context-table) (error "Semantic reset reused a context table"))
 (xml-restore-score-state! snapshot)
 (unless (eq? original ed-context-table) (error "Snapshot lost context table identity"))
 (unless (catch #t
   (lambda () (xml-register-score-collector! (car xml-score-collectors)) #f)
   (lambda args #t))
  (error "Duplicate collector ownership was accepted"))
 (unless (catch #t
   (lambda ()
    (xml-register-score-collector!
     (make-xml-collector-state 'duplicate '(ed-context-table) 'metadata
      (lambda () '()) (lambda (state) #t) (lambda () #t) (lambda () #t)))
    #f)
   (lambda args #t))
  (error "Duplicate field ownership was accepted")))
`;
    const result = await compiler.compile(String.raw`\score { { c'1 } \layout {} }`, {
      includeSettings: '__events.ily',
      files: {
        '__events.ily': listener + probe + '\n#(set! xml-normal-write-pages #f)\n',
      },
    });
    const [document] = readDocuments(result.files);

    assert(document);
    assert.equal(document.events.find((event) => event.k === 'finallayout')?.status, 'complete');
  } finally {
    compiler.dispose();
  }
});
