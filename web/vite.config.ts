import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the site under /<repo-name>/; the deploy workflow sets
  // BASE_PATH from the repo name so a rename doesn't break asset URLs.
  base: process.env.BASE_PATH ?? "/",
  // Phones only allow camera access over HTTPS, so the dev server uses a
  // self-signed certificate and listens on the LAN.
  plugins: [basicSsl()],
  server: { host: true },
});
