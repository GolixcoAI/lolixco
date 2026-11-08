import { Component, type ErrorInfo, type ReactNode } from "react";

export default class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    if (import.meta.env?.DEV) console.info("Lolixco page recovery: unexpected render failure.");
  }
  render() {
    if (this.state.failed) return <div className="app-recovery" role="alert">
      <span className="page-eyebrow">Lolixco</span>
      <h1>Something went wrong</h1>
      <p>We couldn't show this page. Try again, or return to Home.</p>
      <div><button className="primary" onClick={() => this.setState(state => ({ failed: false, attempt: state.attempt + 1 }))}>Try again</button>
        <a href={import.meta.env?.BASE_URL ?? "/"}>Return to Home</a></div>
    </div>;
    return <div key={this.state.attempt} className="app-boundary-content">{this.props.children}</div>;
  }
}
