# Potential upstream contributions

These are follow-up opportunities, not submitted changes. The repository keeps
pinned, licensed community source snapshots in `components/`; the proprietary
GL.iNet web and touchscreen captures under `private/` are reference material
and must not be published as source.

| Project | Focused candidate | Evidence and remaining work |
| --- | --- | --- |
| FIPS core | Enable IPv6 only on the FIPS-owned Linux TUN when a router disables IPv6 globally, and retain IPv4 transport binding. | `components/fips/src/upper/tun.rs` and the scoped IPv6 lab test cover the fix; Stage A linked a peer while GL-E5800 global IPv6 remained disabled. Separate a portable upstream patch and review behavior on other Linux distributions. |
| GL SDK4 community toolkit | Document and test the `eval()` return contract for GL.iNet view bundles, including a webpack example. | `apps/web-ui/webpack.config.cjs` uses the toolkit's `wrapBundleForEval`; the corrected bundle rendered on the GL-E5800. A focused toolkit test/example could prevent blank plugin pages. |
| Community E5800 dashboard | Add a stable panel registration and input-handler extension point. | `dev/device_ui_patch.py` currently injects the FIPS panel through exact source anchors that deliberately fail if upstream layout changes. An upstream extension API would remove this patching dependency. |
| GL.iNet stock UI | Request a supported GL-E5800 touchscreen extension path and stable web-loader contract. | The shipped touchscreen is a compiled application, and no supported plugin API was found in the 4.10.0 capture. This is a vendor interface request, not a source contribution. |

No upstream maintainer has been contacted, and no vendor assets or private
router state should be included in an upstream proposal. Revalidate each
candidate against the relevant project's current source before preparing a PR.
