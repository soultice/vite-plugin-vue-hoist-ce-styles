import type { ViteDevServer, Plugin, ResolvedConfig } from 'vite';
import type { OutputChunk } from 'rollup';

const directRe = /\&direct/;
const styleRe = /(\.css|\&type\=style)/;
const indexRe = /index.*.js/;

const PLACEHOLDER = "ANCHOR"
const virtualId = 'virtual:hoist-ce-styles/css-helper';

enum ExportDeclaration {
  DEFAULT = 'ExportDefaultDeclaration',
}

type StyleCache = ModuleCode[];

type ModuleCode = {
  origin: string;
  code: string;
};

function invalidateStyles(server: ViteDevServer, id: string): void {
  const { moduleGraph, ws } = server;
  const module = moduleGraph.getModuleById(id);
  if (module) {
    moduleGraph.invalidateModule(module);
    if (ws) {
      ws.send({
        type: 'full-reload',
        path: '*',
      });
    }
  }
}

function toStyleCode(styleCache: StyleCache) {
  return styleCache.map(c => c.code).join('')
}

export function hoistCeStyles(): Plugin {
  const styleCache: StyleCache = [];
  let server: ViteDevServer;
  let config: ResolvedConfig;
  return {
    name: 'vite-plugin-vue-hoist-ce-styles',
    enforce: 'post',
    configureServer(_server: ViteDevServer) {
      server = _server;
    },
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    resolveId(id) {
      if (id === virtualId) {
        return virtualId;
      }
    },
    load(id) {
      if (id === virtualId) {
        if (config.command === 'serve') {
          return `export const styles = ${JSON.stringify(toStyleCode(styleCache))}`;
        }
        return `export const styles = ${PLACEHOLDER}`
      }
    },
    async transform(code, id) {
      if (directRe.test(id)) return null;
      if (!styleRe.test(id)) return null;
      const ast: any = this.parse(code);
      // default export of SFC in customElement mode will always be in the form of
      // "export default " ... styles " <-- this is what we care about.
      // we overwrite the styles with the export of our virtual module
      if (ast.body[0]?.type === ExportDeclaration.DEFAULT) {
        const styleCode = ast.body[0].declaration.value;
        if (styleCode) {
          const cachePos = styleCache.findIndex((c) => c.code === styleCode);
          const cacheObj = { origin: id, code: styleCode };
          if (cachePos >= 0) {
            styleCache[cachePos] = cacheObj;
          } else {
            styleCache.push(cacheObj);
          }
          if (config.command === 'serve') {
            invalidateStyles(server, virtualId);
          }
          return {
            code: `import { styles } from "${virtualId}"\nexport default styles`,
            map: null,
          };
        }
      }
    },
    generateBundle(_, bundle) {
      // for the bundle step we replace all styles that we have in our cache
      // with the complete styles
      for (const [b, c] of Object.entries(bundle)) {
        const jsOutFile = indexRe.test(b);
        if (jsOutFile) {
          const chunk = c as OutputChunk;
          (bundle[b] as OutputChunk).code = chunk.code.replace(new RegExp(PLACEHOLDER, 'g'), JSON.stringify(toStyleCode(styleCache)))
        }
      }
    },
  };
}
