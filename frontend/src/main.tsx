import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/rubik/wght.css';
import '@/styles/global.css';
import { App } from '@/app/app';

const root = document.getElementById('root');

if (!root) {
  throw new Error('The application root is missing.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
