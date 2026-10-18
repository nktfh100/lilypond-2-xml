import { readFileSync } from 'node:fs';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
const toolkit = new VerovioToolkit(await createModule());

try {
  toolkit.loadData(readFileSync(0, 'utf8'));
} finally {
  toolkit.destroy();
}
