import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface Props  { children: ReactNode; }
interface State  { hasError: boolean; message: string; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message ?? "Unknown error" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, message: "" });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        color: "#f1f5f9",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
        textAlign: "center",
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 8, letterSpacing: "-0.02em" }}>
          Something went wrong
        </div>
        <div style={{
          color: "#94a3b8", fontSize: 13, maxWidth: 320,
          lineHeight: 1.6, marginBottom: 8, fontFamily: "monospace",
        }}>
          {this.state.message}
        </div>
        <div style={{ color: "#64748b", fontSize: 12, marginBottom: 28 }}>
          No sale data was lost. You can safely reload.
        </div>
        <button
          onClick={this.handleReload}
          style={{
            padding: "14px 32px",
            background: "linear-gradient(135deg, #eab308, #f59e0b)",
            border: "none", borderRadius: 12,
            fontWeight: 800, fontSize: 14, color: "#000",
            cursor: "pointer", letterSpacing: "0.02em",
          }}>
          Reload Terminal
        </button>
      </div>
    );
  }
}
