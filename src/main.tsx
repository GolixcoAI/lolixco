import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import App from "./App";
import { previewCatalog } from "./preview-catalog";
import "./styles/index.css";
import "./components/studio/studio.css";
import "./components/studio/rating.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App initialEdits={previewCatalog} />
  </React.StrictMode>,
);
