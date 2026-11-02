import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { watchInstall } from './lib/install';
import { registerServiceWorker } from './lib/serviceWorker';
import './styles/tokens.css';
import './styles/app.css';

registerServiceWorker();
watchInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
