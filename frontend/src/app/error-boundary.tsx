import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <main className='error-page'>
          <h1>Something went wrong.</h1>
          <p>Reload the page to start a new conversion.</p>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </main>
      );
    }

    return this.props.children;
  }
}
