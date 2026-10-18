declare module '*runtime.mjs' {
  export type LilyPondFormat = 'svg' | 'pdf' | 'png' | 'ps' | 'eps' | 'midi';
  export type RuntimeAssets = readonly (readonly [path: string, bytes: Uint8Array])[];

  export interface CompileOptions {
    readonly assets?: RuntimeAssets;

    readonly wasmModule?: WebAssembly.Module;

    readonly files?: Readonly<Record<string, Uint8Array | string>>;

    readonly includePaths?: readonly string[];

    readonly filename?: string;

    readonly format?: LilyPondFormat | readonly LilyPondFormat[];

    readonly resolution?: number;

    readonly includeSettings?: string;
    readonly onLog?: (text: string) => void;
  }

  export interface CompileResult {
    readonly exitCode: number;
    readonly logs: readonly string[];
    readonly files: Readonly<Record<string, Uint8Array>>;
  }

  export type DownloadProgressCallback = (loadedBytes: number, totalBytes: number) => void;

  export function loadRuntime(
    bytes?: ArrayBuffer | Uint8Array,
    options?: { readonly onProgress?: DownloadProgressCallback },
  ): Promise<RuntimeAssets>;
  export function loadWasm(options?: {
    readonly onProgress?: DownloadProgressCallback;
  }): Promise<WebAssembly.Module>;
  export function compile(source: string, options?: CompileOptions): Promise<CompileResult>;
}
