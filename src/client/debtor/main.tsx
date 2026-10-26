import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DebtorApp } from "./DebtorApp";
import "../styles.css";

// Entrada separada (/devedor): quem te deve não carrega o app inteiro, só esta página.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DebtorApp />
  </StrictMode>,
);
