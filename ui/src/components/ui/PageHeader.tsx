import React from "react";

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "var(--space-4)",
        marginBottom: "var(--space-6)",
        flexWrap: "wrap",
      }}
    >
      <div>
        <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</h1>
        {description && (
          <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--text-base)", marginTop: "var(--space-1)" }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}
