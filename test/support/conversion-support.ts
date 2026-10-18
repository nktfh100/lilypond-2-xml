import { createConverter } from 'lilypond-2-xml';
import { after } from 'node:test';

export * from './xml-support.js';

export const converter = createConverter();
after(() => converter.dispose());
