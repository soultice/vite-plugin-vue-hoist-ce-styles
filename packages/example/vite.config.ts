import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { hoistCeStyles } from 'vite-plugin-vue-hoist-ce-styles';

// https://vitejs.dev/config/
export default defineConfig({
  clearScreen: false,
  plugins: [vue({ customElement: true }), hoistCeStyles({ entryComponent: 'App.vue'})],
  build: {
    target: 'esnext',
    minify: false,
    rollupOptions: {
      output: {
        minifyInternalExports: false,
        format: 'esm',
        entryFileNames: `[name].js`,
        chunkFileNames: `[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },
});
