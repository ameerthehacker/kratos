import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom"; // v8: RouterProvider lives in react-router/dom
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import "./index.css";
import { appHotkeys } from "./lib/shortcuts.js";
import { router } from "./router.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Every shortcut, declared up front (3k, D66); the user's own bindings will plug in here. */}
    <HotkeysProvider appHotkeys={appHotkeys}>
      <RouterProvider router={router} />
    </HotkeysProvider>
  </StrictMode>,
);
