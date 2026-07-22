import React, { useState } from "react";

interface JsonViewerProps {
  data: unknown;
  /** Maximum depth to auto-expand. Default: 2. */
  defaultExpandDepth?: number;
  /** Current depth (internal, used for recursion). */
  depth?: number;
}

/**
 * A JSON viewer component with IDE-like syntax highlighting.
 * Features:
 * - Colored keys, strings, numbers, booleans, null
 * - Collapsible nested objects/arrays
 * - Monospace font
 * - Indentation guides
 */
export function JsonViewer({ data, defaultExpandDepth = 2, depth = 0 }: JsonViewerProps) {
  const [isExpanded, setIsExpanded] = useState(depth < defaultExpandDepth);

  if (data === null || data === undefined) {
    return <span style={{ color: "#569cd6", fontStyle: "italic" }}>null</span>;
  }

  if (typeof data === "boolean") {
    return <span style={{ color: "#569cd6" }}>{String(data)}</span>;
  }

  if (typeof data === "number") {
    return <span style={{ color: "#b5cea8" }}>{String(data)}</span>;
  }

  if (typeof data === "string") {
    return <span style={{ color: "#ce9178" }}>"{escapeString(data)}"</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span style={{ color: "#808080" }}>[]</span>;
    }

    return (
      <span>
        <span
          onClick={() => setIsExpanded(!isExpanded)}
          style={{ cursor: "pointer", userSelect: "none", color: "#d4d4d4" }}
        >
          {isExpanded ? "▼" : "▶"} [
        </span>
        {isExpanded && (
          <span>
            {data.map((item, index) => (
              <span key={index}>
                <br />
                <span style={{ paddingLeft: `${(depth + 1) * 16}px`, display: "block" }}>
                  <JsonViewer data={item} defaultExpandDepth={defaultExpandDepth} depth={depth + 1} />
                  {index < data.length - 1 && <span style={{ color: "#808080" }}>,</span>}
                </span>
              </span>
            ))}
            <span style={{ paddingLeft: `${depth * 16}px` }}>]</span>
          </span>
        )}
        {!isExpanded && (
          <span style={{ color: "#808080" }}>
            {" "}
            {data.length} item{data.length !== 1 ? "s" : ""}
          </span>
        )}
        {!isExpanded && <span style={{ color: "#d4d4d4" }}> ]</span>}
      </span>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) {
      return <span style={{ color: "#808080" }}>{}</span>;
    }

    return (
      <span>
        <span
          onClick={() => setIsExpanded(!isExpanded)}
          style={{ cursor: "pointer", userSelect: "none", color: "#d4d4d4" }}
        >
          {isExpanded ? "▼" : "▶"} {"{"}
        </span>
        {isExpanded && (
          <span>
            {entries.map(([key, value], index) => (
              <span key={key}>
                <br />
                <span style={{ paddingLeft: `${(depth + 1) * 16}px`, display: "block" }}>
                  <span style={{ color: "#9cdcfe" }}>"{key}"</span>
                  <span style={{ color: "#d4d4d4" }}>: </span>
                  <JsonViewer data={value} defaultExpandDepth={defaultExpandDepth} depth={depth + 1} />
                  {index < entries.length - 1 && <span style={{ color: "#808080" }}>,</span>}
                </span>
              </span>
            ))}
            <span style={{ paddingLeft: `${depth * 16}px` }}>{"}"}</span>
          </span>
        )}
        {!isExpanded && (
          <span style={{ color: "#808080" }}>
            {" "}
            {entries.length} key{entries.length !== 1 ? "s" : ""}
          </span>
        )}
        {!isExpanded && <span style={{ color: "#d4d4d4" }}> {"}"}</span>}
      </span>
    );
  }

  return <span>{String(data)}</span>;
}

function escapeString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

