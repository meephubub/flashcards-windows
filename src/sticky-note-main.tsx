import React from "react";
import ReactDOM from "react-dom/client";
import { StickyNote } from "./StickyNote";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StickyNote />
  </React.StrictMode>,
);
