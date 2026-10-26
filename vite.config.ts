import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  // host: true deixa abrir pelo celular na mesma rede (http://<ip-do-mac>:5173)
  server: { host: true },
  // Duas páginas: o app (index.html) e a página dos devedores (devedor.html, servida em /devedor)
  environments: {
    client: { build: { rolldownOptions: { input: { main: "index.html", devedor: "devedor.html" } } } },
  },
  optimizeDeps: { include: ["react", "react-dom", "react-dom/client", "lucide-react"] },
});
