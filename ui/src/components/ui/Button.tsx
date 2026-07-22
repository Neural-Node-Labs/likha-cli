import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", className, ...rest }, ref) => (
    <button ref={ref} className={["xcoder-btn", `xcoder-btn--${variant}`, className].filter(Boolean).join(" ")} {...rest} />
  )
);
Button.displayName = "Button";
