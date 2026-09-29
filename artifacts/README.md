# Local package artifacts

Generated/downloaded `.ipk` files live here and are ignored by Git. Register each
artifact's absolute path and SHA-256 in a private Ansible variables file. The
recovery tool validates package metadata and payload paths before uploading.

FIPS: use the pinned upstream release or build components/fips/packaging/openwrt-ipk.
Device UI: run `sh components/device-ui/packages/build.sh`, then copy the resulting
IPK here. Web UI: the imported toolkit builds extension packages; no FIPS web view
has been implemented yet. Do not register stock `gl-sdk4-ui-core` or `gl_screen`
packages as recovery artifacts.
