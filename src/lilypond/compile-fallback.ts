export function isWebAssemblyTrap(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('RuntimeError: unreachable');
}

export async function compileWithPageBreakingFallback<T>(
  compile: (pageBreakingFallback: boolean) => Promise<T>,
): Promise<{ result: T; pageBreakingFallback: boolean }> {
  try {
    return { result: await compile(false), pageBreakingFallback: false };
  } catch (error) {
    if (!isWebAssemblyTrap(error)) {
      throw error;
    }

    return { result: await compile(true), pageBreakingFallback: true };
  }
}
