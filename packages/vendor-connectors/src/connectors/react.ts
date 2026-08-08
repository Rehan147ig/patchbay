import { defineConnector } from "../sdk";

/**
 * React connector.
 *
 * Covers long-running deprecations that become breaking across major
 * versions, and the modern JSX transform:
 * - `ReactDOM.render` -> `createRoot(...).render(...)` (React 18).
 * - `componentWillMount`/`componentWillReceiveProps`/`componentWillUpdate`
 *   are removed in React 18 (they were removed in 16.9 with a migration path).
 * - Default props via `Component.defaultProps` are deprecated for function
 *   components.
 * - The classic `React.createElement` runtime is replaced by the automatic
 *   JSX runtime (no `import React from "react"` needed).
 */
export const reactConnector = defineConnector({
  slug: "react",
  identifiers: ["react", "react-dom"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "ReactDOM.render",
      newValue: "createRoot().render()",
      description:
        "React 18 removed `ReactDOM.render`; use `createRoot(container).render(<App/>)` from react-dom/client.",
      affectedSymbols: ["ReactDOM.render"],
      breaking: true,
      evidence: { sdk: "react" },
    },
    {
      changeType: "METHOD_REMOVED",
      oldValue: "componentWillMount",
      newValue: "componentDidMount / getDerivedStateFromProps",
      description:
        "React 18 removed the `componentWillMount` lifecycle; move side effects to `componentDidMount`.",
      affectedSymbols: ["componentWillMount", "componentWillReceiveProps", "componentWillUpdate"],
      breaking: true,
      evidence: { sdk: "react" },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "defaultProps",
      description:
        "`defaultProps` on function components is deprecated; use default parameters in the destructured props.",
      affectedSymbols: ["defaultProps"],
      breaking: false,
      evidence: { sdk: "react" },
    },
  ],
  patchSuggestions: {
    "ReactDOM.render": {
      replacement: "createRoot().render",
      description:
        "Replace `ReactDOM.render(element, container)` with `createRoot(container).render(element)` (import { createRoot } from 'react-dom/client').",
      confidence: 90,
    },
    componentWillMount: {
      replacement: "componentDidMount",
      description:
        "Move `componentWillMount` logic into `componentDidMount` (React 18 removed the lifecycle).",
      confidence: 85,
    },
  },
});
