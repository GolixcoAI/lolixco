import type { ReactNode } from "react";
import { CircleAlert, Search } from "lucide-react";

export interface ProductStateProps {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  children?: ReactNode;
  className?: string;
  kind?: "empty" | "error" | "notice";
}

export function ProductState({ title, description, action, children, className = "", kind = "empty" }: ProductStateProps) {
  const Icon = kind === "error" ? CircleAlert : Search;
  return <div className={`product-state product-state--${kind} ${className}`} role={kind === "error" ? "alert" : undefined}>
    <Icon className="product-state__icon" size={28} aria-hidden="true"/>
    <h2>{title}</h2>
    {description && <p>{description}</p>}
    {(action || children) && <div className="product-state__actions">
      {action && <button type="button" className="primary" onClick={action.onClick}>{action.label}</button>}
      {children}
    </div>}
  </div>;
}

export default ProductState;
