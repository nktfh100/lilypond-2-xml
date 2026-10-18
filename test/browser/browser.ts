import { convert, createConverter } from '../../dist/index.js';

declare global {
  interface Window {
    lilypond: {
      convert: typeof convert;
      createConverter: typeof createConverter;
    };
  }
}
window.lilypond = { convert, createConverter };
