import React from "react";
import ReactDOM from "react-dom/client";
import { MoodboardTileWindow } from "./MoodboardTileWindow";
import "./index.css";

const tileKind = new URLSearchParams(window.location.search).get("kind") ?? "text";

document.documentElement.classList.add("moodboard-tile-page");
document.body.classList.add("moodboard-tile-page");

if (tileKind === "image") {
  document.documentElement.classList.add("moodboard-tile-page--image");
  document.body.classList.add("moodboard-tile-page--image");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MoodboardTileWindow />
  </React.StrictMode>,
);
