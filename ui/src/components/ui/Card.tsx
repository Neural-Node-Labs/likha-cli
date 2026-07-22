import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padding?: "sm" | "md" | "lg";
}

const PADDING = { sm: "var(--space-4)", md: "var(--space-6)", lg: "var(--space-8)" };

/** The one bordered-box style every page should use instead of re-declaring it inline. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ interactive, padding = "md", className, style, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={["xcoder-card", interactive ? "xcoder-card--interactive" : "", className].filter(Boolean).join(" ")}
      style={{ padding: PADDING[padding], ...style }}
      {...rest}
    >
      {children}
    </div>
  )
);
Card.displayName = "Card";
