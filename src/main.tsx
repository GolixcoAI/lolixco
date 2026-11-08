import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import App from "./App";
import AppBoundary from "./components/layout/AppBoundary";
import { previewCatalog } from "./preview-catalog";
import "./styles/index.css";
import "./components/studio/studio.css";
import "./components/studio/rating.css";
import "./styles/shell.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppBoundary><App initialEdits={previewCatalog} /></AppBoundary>
  </React.StrictMode>,
);
