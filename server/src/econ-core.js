// ESM shim over the shared shopkeeper price engine (shared/econ-core.js —
// a plain script that attaches one global, ZoneBakeCore pattern). esbuild
// bundles the side-effect import; this re-export gives the worker the same
// byte-identical math the game bundle runs.
import "../../shared/econ-core.js";
export default globalThis.EconCore;
