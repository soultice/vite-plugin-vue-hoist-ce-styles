import type { ViteDevServer, Plugin, ResolvedConfig } from 'vite';
import type { OutputChunk } from 'rollup';

const directRe = /\&direct/;
const styleRe = /(\.css|\&type\=style)/;
const indexRe = /index.*.js/;

const PLACEHOLDER_BEGIN = 'ANCHOR:BEGIN';
const PLACEHOLDER_END = 'ANCHOR:END';
const placeHolderRe = /\"ANCHOR\:BEGIN(.*?)ANCHOR\:END\"/g;
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
  return styleCache.map((c) => c.code).join('');
}

export function hoistCeStyles({ hostComponent }: { hostComponent: string }): Plugin {
  const styleCache: StyleCache = [];
  const hostComponentRe = new RegExp(hostComponent);
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
          const cachePos = styleCache.findIndex((c) => c.origin === id);
          const cacheObj = { origin: id, code: styleCode };
          if (cachePos >= 0) {
            styleCache[cachePos] = cacheObj;
          } else {
            styleCache.push(cacheObj);
          }
          let code
          if (config.command === 'serve') {
            invalidateStyles(server, virtualId);
            if (hostComponentRe.test(id)) {
              code = `import { styles } from "${virtualId}"\nexport default styles`;
            } else {
              code = `export default ''`;
            }
          } else {
            code =  `const styles = "${PLACEHOLDER_BEGIN}${id}${PLACEHOLDER_END}"\nexport default styles`;
          }
          return {
            code,
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
          let chunk = c as OutputChunk;
          const matches = chunk.code.matchAll(placeHolderRe);
          for (const m of matches) {
            if (hostComponentRe.test(m[1])) {
              chunk.code = chunk.code.replace(m[0], JSON.stringify(toStyleCode(styleCache)));
            } else {
              chunk.code = chunk.code.replace(m[0], "''");
            }
            bundle[b] = chunk;
          }
        }
      }
    },
  };
}
