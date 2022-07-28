import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { hoistCeStyles } from 'vite-plugin-vue-hoist-ce-styles';

// https://vitejs.dev/config/
export default defineConfig({
  clearScreen: false,
  plugins: [vue({ customElement: true }), hoistCeStyles()],
});
