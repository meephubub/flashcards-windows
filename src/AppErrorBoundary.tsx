import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-shell auth-shell">
          <div className="auth-card">
            <p className="eyebrow">Flashcards</p>
            <h1>Something went wrong</h1>
            <p className="auth-error" style={{ color: "rgba(23, 23, 23, 0.72)" }}>
              {this.state.error.message}
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
