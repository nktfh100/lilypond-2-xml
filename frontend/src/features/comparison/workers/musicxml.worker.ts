import { expose } from 'comlink';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { evaluateScore } from '@/features/evaluation/services/evaluate-score';
import type { RenderedScore, ScorePreview, ScoreRenderInput } from '../types';

const renderer = {
  async renderScores(scores: ScoreRenderInput[]): Promise<RenderedScore[]> {
    const toolkit = new VerovioToolkit(await createModule());

    try {
      toolkit.setOptions({
        inputFrom: 'musicxml',
        breaks: 'encoded',
        pageWidth: 2100,
        pageHeight: 2970,
        scale: 40,
        svgViewBox: true,
        footer: 'none',
      });

      return scores.map(({ musicxml, reference }) => {
        let preview: ScorePreview;
        let loaded = false;

        try {
          loaded = Boolean(toolkit.loadData(musicxml));

          if (!loaded || toolkit.getPageCount() === 0) {
            throw new Error('The converted score preview is unavailable.');
          }

          preview = {
            pages: Array.from({ length: toolkit.getPageCount() }, (_, index) =>
              toolkit.renderToSVG(index + 1),
            ),
          };
        } catch {
          preview = {
            error:
              'The converted score preview is unavailable. You can still download the MusicXML and open it in your music app.',
          };
        }

        const evaluation = evaluateScore(musicxml, reference, () => {
          if (!loaded) {
            throw new Error('The converted score could not be played back.');
          }

          return toolkit.renderToMIDI();
        });

        return { preview, ...evaluation };
      });
    } finally {
      toolkit.destroy();
    }
  },
};

export type MusicXmlRenderer = typeof renderer;

expose(renderer);
