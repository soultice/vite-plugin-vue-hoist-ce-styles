import type { ViteDevServer, Plugin, ResolvedConfig } from 'vite';
import type { OutputChunk } from 'rollup';

const directRe = /\&direct/;
const styleRe = /(\.css|\&type\=style)/;
const indexRe = /index.*.js/;

const PLACEHOLDER_BEGIN = 'ANCHOR:BEGIN';
const PLACEHOLDER_END = 'ANCHOR:END';
const placeHolderRe = /\"ANCHOR\:BEGIN(.*?)ANCHOR\:END\"/g;

const assetUrlRE = /__VITE_ASSET__([a-z\d]{8})__(?:\$_(.*?)__)?/g
const assetRetrievalRE = /const __([a-z\d]{8})__ \= (.*?);/g

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
  let refMap = new Map<string, string>();
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

        const localAssetRefs: Map<string, string> = new Map()
        let assetRefs: RegExpExecArray | null = styleCode.matchAll(assetUrlRE)
        if (assetRefs != null) {
          for (const r of assetRefs) {
            localAssetRefs.set(r[1], r[0]) 
          }
        }
        const refCode = [...localAssetRefs].reduce(function (current, [hash, linkedRef]) {
          return `\n${current}const __${hash}__ = ${linkedRef}`
        }, '')
        refMap = new Map([...refMap, ...localAssetRefs])

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
            code =  `const styles = "${PLACEHOLDER_BEGIN}${id}${PLACEHOLDER_END}";\nexport default styles;${refCode}`;
          }
          return {
            code,
            moduleSideEffects: 'no-treeshake',
            map: null,
          };
        }
      }
    },
    generateBundle(_, bundle) {
      // for the bundle step we replace the styles of hostComponent with all found styles
      for (const [b, c] of Object.entries(bundle)) {
        const jsOutFile = indexRe.test(b);
        if (jsOutFile) {
          let styleCode = JSON.stringify(toStyleCode(styleCache))
          let chunk = c as OutputChunk;

          // re-add asset urls and clean up afterwards
          const assets = chunk.code.matchAll(assetRetrievalRE);
          for (const asset of assets) {
            styleCode = styleCode.replace(refMap.get(String(asset[1]))!, asset[2])
          }
          chunk.code = chunk.code.replace(assetRetrievalRE, '')

          const matches = chunk.code.matchAll(placeHolderRe);
          for (const m of matches) {
            if (hostComponentRe.test(m[1])) {
              chunk.code = chunk.code.replace(m[0], styleCode);
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
