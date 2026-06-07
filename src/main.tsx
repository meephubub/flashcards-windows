import React from "react";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { DecksActionSearchBar } from "./action-search-bar";
import "./index.css";
import UpdateChecker from "./UpdateChecker";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <DecksActionSearchBar />
      <UpdateChecker />
    </AppErrorBoundary>
  </React.StrictMode>,
);
