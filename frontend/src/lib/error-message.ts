export class UserFacingError extends Error {}

export function errorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (error instanceof UserFacingError) {
    return error.message;
  }

  if (!(error instanceof Error)) {
    return fallback;
  }

  if (
    /failed to fetch|fetch failed|networkerror|load failed|download failed/i.test(error.message)
  ) {
    return 'A required download failed. Check your internet connection and try again.';
  }

  if (/source must be a nonempty string/.test(error.message)) {
    return 'Choose a LilyPond file or paste a score before converting.';
  }

  if (/no printed score documents/.test(error.message)) {
    return 'This file has no sheet music to convert. Choose a file that produces a printed score.';
  }

  if (error.name === 'LilyPondCompileError') {
    const logs =
      'logs' in error && Array.isArray(error.logs)
        ? error.logs.filter((line): line is string => typeof line === 'string').join('\n')
        : error.message;

    if (/cannot find file|failed to find file|cannot open file/i.test(logs)) {
      return 'This score needs another file. Add the missing file using “Include files”, then try again.';
    }

    const location = /(?:^|\n)([^\n]*?\.(?:ly|ily)):(\d+):\d+:\s*(?:fatal )?error:/i.exec(logs);

    if (location) {
      const filename = location[1]!.split(/[\\/]/).pop();

      return `The score could not be read near line ${location[2]} in “${filename}”. Check that part of the file and try again.`;
    }

    return 'The score could not be read. Check that it opens correctly in LilyPond and that all required files are included.';
  }

  return fallback;
}
