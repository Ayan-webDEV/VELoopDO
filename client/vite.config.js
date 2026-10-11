import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tailwindcss()],

    // Expose only these two explicitly selected public variables.
    define: {
      "import.meta.env.API_URL": JSON.stringify(env.API_URL),
      "import.meta.env.APP_NAME": JSON.stringify(env.APP_NAME),
    },

    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
    },

    preview: {
      host: "0.0.0.0",
      port: 4173,
      strictPort: true,
    },

    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
