import type { ViteDevServer, Plugin, ResolvedConfig } from 'vite';
import type { OutputChunk } from 'rollup';

const directRe = /\&direct/;
const styleRe = /(\.css|\&type\=style)/;
const defaultIndexRe = /index.*.js/;

const PLACEHOLDER_BEGIN = 'ANCHOR:BEGIN';
const PLACEHOLDER_END = 'ANCHOR:END';
const placeHolderRe = /\"ANCHOR\:BEGIN(.*?)ANCHOR\:END\"/g;

const assetUrlRE = /__VITE_ASSET__([a-z\d]{8})__(?:\$_(.*?)__)?/g;
const assetRetrievalRE = /const __([a-z\d]{8})__ \= (.*?);/g;

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

function toRefCode(referenceMap: Map<string, string>) {
  return [...referenceMap].reduce((current, [hash, linkedRef]) =>
    `${current}\nconst __${hash}__ = ${linkedRef}`
    , '');
}

export function hoistCeStyles({ hostComponent, indexRe = defaultIndexRe }: { hostComponent: string, indexRe: RegExp }): Plugin {
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

        if (styleCode) {
          const cachePos = styleCache.findIndex((c) => c.origin === id);
          const cacheObj = { origin: id, code: styleCode };
          if (cachePos >= 0) {
            styleCache[cachePos] = cacheObj;
          } else {
            styleCache.push(cacheObj);
          }
          let code;
          if (config.command === 'serve') {
            invalidateStyles(server, virtualId);
            if (hostComponentRe.test(id)) {
              code = `import { styles } from "${virtualId}"\nexport default styles`;
            } else {
              code = `export default ''`;
            }
          } else {
            // if asset urls are used in css vite replaces them with __VITE_ASSET__hash__
            // we need to hold a reference to these assets and leave them in the code so
            // they are parsed by the assetPlugin of vite during renderChunk
            // we retrieve these references in the generateBundle hook and replace
            // our unparsed assets
            const localAssetRefs: Map<string, string> = new Map();
            let assetRefs: RegExpExecArray | null = styleCode.matchAll(assetUrlRE);
            if (assetRefs != null) {
              for (const [asset, hash] of assetRefs) {
                localAssetRefs.set(hash, asset);
              }
            }
            refMap = new Map([...refMap, ...localAssetRefs]);

            code = `const styles = "${PLACEHOLDER_BEGIN}${id}${PLACEHOLDER_END}";\nexport default styles;${toRefCode(localAssetRefs)};`;
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
      // for the bundle step we replace the styles of hostComponent with all found styles if it's the entrypoint
      // else we remove the styles for performance
      for (const [b, c] of Object.entries(bundle)) {
        const jsOutFile = indexRe.test(b);
        if (jsOutFile) {
          let styleCode = JSON.stringify(toStyleCode(styleCache));
          let chunk = c as OutputChunk;

          // re-add asset urls and clean up afterwards
          const assets = chunk.code.matchAll(assetRetrievalRE);
          for (const [_, hash, url] of assets) {
            styleCode = styleCode.replace(refMap.get(hash)!, url);
          }
          chunk.code = chunk.code.replace(assetRetrievalRE, '');

          const componentStyles = chunk.code.matchAll(placeHolderRe);
          for (const [anchor, id] of componentStyles) {
            if (hostComponentRe.test(id)) {
              chunk.code = chunk.code.replace(anchor, styleCode);
            } else {
              chunk.code = chunk.code.replace(anchor, "''");
            }
            bundle[b] = chunk;
          }
        }
      }
    },
  };
}
