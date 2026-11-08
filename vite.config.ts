import publicPages from "./scripts/public-pages-plugin.mjs";
import {localDnaBridge,dnaProxy} from "./scripts/local-dna/bridge.mjs";
import { defineConfig } from "vite";
import { checkAssets } from "./scripts/check-assets.mjs";

export default defineConfig({
  server: {
    proxy: {
      ...(process.env.LOLIXCO_LOCAL_DNA==='1'?{"/api/v8":dnaProxy()}:{}),
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    publicPages(),
    ...(process.env.LOLIXCO_LOCAL_DNA==='1'?[localDnaBridge()]:[]),
    {
      name: "verify-local-assets",
      buildStart() {
        checkAssets();
      },
    },
  ],
});
