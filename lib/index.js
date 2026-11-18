/**
 * Runtime HUD — host (server) half.
 *
 * This plugin is presentation-only: it reads existing Session projections and
 * renders a status strip client-side (see `./client` → `lib/client.js`). The
 * host side registers no services, exposes no tools, and mutates no
 * model-side state. This module exists so the entry import of the package
 * root resolves; cordis then reads `dsh.client` from the manifest and the
 * web host serves the browser bundle from the `./client` export.
 */

/** Host entry hook. Intentionally a no-op. */
function apply() {
	/* presentation-only plugin: nothing to configure on the host */
}

export { apply };
