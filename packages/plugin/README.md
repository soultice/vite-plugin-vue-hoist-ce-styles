## Vite-Plugin-Vue-Hoist-Ce-Styles


### Caveats

- CSS imports outside of SFCs won't work. E.g. the default `import 'styles.css'` in main.ts will work in dev but break the build.
- Your bundle must be named `index.%%ANYTHING%%.js` as the plugin is testing against `/index.*.js` to replace styles in the final bundle
- Plugin has no unit tests right now, and is largely untested, use with caution

### Installation

Run

> npm i -D vite-plugin-vue-hoist-ce-styles  

or  

> yarn add --dev vite-plugin-vue-hoist-ce-styles

### Usage

In your `vite.config.(js|ts)` import the plugin and register it.
Also make sure that `customElement: true` is passed to the vue plugin

```typescript
import { hoistCeStyles } from 'vite-plugin-vue-hoist-ce-styles';

plugins: [vue({ customElement: true }), hoistCeStyles({hostComponent: 'App.vue'})],
```



