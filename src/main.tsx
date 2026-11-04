import React from "react";
import * as Sentry from "@sentry/react";

import { 
  useLocation, 
  useNavigationType, 
  createRoutesFromChildren, 
  matchRoutes 
} from "react-router-dom";

// ✅ Sentry.init runs before ReactDOM.createRoot
Sentry.init({
  dsn: "https://fee0bf91979cd5948e9f5fdcec8ca473@o4512328803287040.ingest.de.sentry.io/4512336967434320",
  environment: import.meta.env.MODE,
  // This is the key change — route events through your own domain
  tunnel: "/api/monitoring", 
  integrations: [
    Sentry.reactRouterBrowserTracingIntegration({
      useEffect: React.useEffect, 
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
    }),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

// Now import ReactDOM and mount the app
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);