import { ConverterWorkspace } from '@/features/converter/components/converter-workspace';
import { ErrorBoundary } from './error-boundary';

export function App() {
  return (
    <ErrorBoundary>
      <ConverterWorkspace />
    </ErrorBoundary>
  );
}
