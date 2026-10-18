declare module 'verovio/wasm' {
  export default function createModule(): Promise<unknown>;
}

declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    destroy(): void;
    loadData(data: string): number;
    setOptions(options: Record<string, unknown>): void;
    getPageCount(): number;
    renderToSVG(page: number): string;
    renderToMIDI(): string;
  }
}
