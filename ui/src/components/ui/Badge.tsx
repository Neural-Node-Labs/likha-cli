import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "success" | "warning" | "error" | "primary";
}

export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  const toneClass = tone === "neutral" ? "" : `xcoder-badge--${tone}`;
  return (
    <span className={["xcoder-badge", toneClass, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </span>
  );
}
