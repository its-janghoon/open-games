import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import './styles/global.css';
import App from './App';
import { registerLobbyHandle } from './online/lobbyHandle';

// Registered here rather than in a component: it belongs to the page, not to a screen's lifecycle, and a component that
// mounted it would unmount it again on navigation.
registerLobbyHandle();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
