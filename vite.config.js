import { defineConfig } from "vite";
import { freePort } from "./scripts/free-port.mjs";

export default defineConfig(async ({ command }) => {
  if (command === "serve") {
    await freePort(33223);
  }

  return {
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      // Not Vite's 5173: keep this app off other local Vite projects.
      port: 33223,
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});

