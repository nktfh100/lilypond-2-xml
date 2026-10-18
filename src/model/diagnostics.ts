export interface Diagnostic {
  code: string;
  message: string;
}

export type Warn = (code: string, message: string) => void;
