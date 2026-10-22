import { defineConfig } from "vite";
export default defineConfig({base:"./",build:{rollupOptions:{
 input:{main:"index.html",background:"background.html"},
 onwarn(warning,warn){if(warning.code==="MODULE_LEVEL_DIRECTIVE"&&warning.message.includes('"use client"'))return;warn(warning);},
 output:{manualChunks(id){if(/node_modules\/(react|react-dom|react-is|scheduler)\//.test(id))return "react";if(/node_modules\/(@mui|@emotion|stylis)\//.test(id))return "material-ui";}}
}}});
