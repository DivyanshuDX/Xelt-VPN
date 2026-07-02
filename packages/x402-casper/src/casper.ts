/**
 * casper-js-sdk ships a webpack UMD/CJS bundle. Its interop differs by host:
 *   - ESM (vitest, Vite, tsx-ESM): only the synthesized `default` carries the exports.
 *   - CJS (tsx-CommonJS, e.g. vpn-server): named props exist, `default` is undefined.
 * Normalize both into a single object so the rest of the package can use one import.
 */
import * as casperNs from 'casper-js-sdk';

type CasperModule = typeof import('casper-js-sdk');

const Casper: CasperModule = (
  'Deploy' in casperNs
    ? (casperNs as unknown as CasperModule)
    : (casperNs as unknown as { default: CasperModule }).default
);

export default Casper;
