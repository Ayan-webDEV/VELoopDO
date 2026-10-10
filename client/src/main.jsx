import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error(
    'VELoopDO could not start because the HTML element with id="root" was not found.',
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
