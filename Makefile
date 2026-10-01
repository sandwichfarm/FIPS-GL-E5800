DEV_IMAGE := e5800-dev:0.2.0
BUILD_PLATFORM := linux/arm64
NODE_IMAGE := node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34
PLAYWRIGHT_IMAGE := mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
PROJECT_MOUNT := -v "$(CURDIR):/workspace" -w /workspace
RUST_RUN := docker run --rm --platform $(BUILD_PLATFORM) -e SOURCE_DATE_EPOCH=1788220800 -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/workspace $(PROJECT_MOUNT) -v "$(CURDIR)/.cache/cargo-registry:/usr/local/cargo/registry" $(DEV_IMAGE) sh -c
NODE_RUN := docker run --rm --user "$(shell id -u):$(shell id -g)" -e HOME=/workspace/.cache -e npm_config_cache=/workspace/.cache/npm $(PROJECT_MOUNT) -w /workspace/apps/web-ui $(NODE_IMAGE)
ANSIBLE_LOCAL_TEMP ?= $(CURDIR)/.cache/ansible-tmp
export ANSIBLE_LOCAL_TEMP

.PHONY: check vendor-deps dependency-audit inspect inspect-dependencies capture dashboard dev-image rust-check rust-test web-deps web-build web-test web-browser-test web-live-browser-test web-preview web-preview-host web-preview-serve web-preview-host-serve \
        lab-build lab-up lab-test lab-down scoped-ipv6-test route-lan-test device-preview device-preview-host openwrt-build \
        package-fips package-web package-device

check:
	python3 tools/check_sources.py
	python3 -m unittest discover -s tests -v
	for file in packaging/recovery/guard.sh packaging/recovery/health.sh packaging/recovery/apply-initial.sh packaging/recovery/cleanup-stock.sh packaging/recovery/cleanup-bootstrap.sh packaging/recovery/cleanup-upgrade.sh packaging/fips/files/etc/init.d/fips packaging/fips/files/etc/init.d/fips-gateway packaging/web-ui/files/www/cgi-bin/gl-sdk4-ui-fips; do sh -n "$$file"; done
	cd ansible && ansible-playbook inspect.yml --syntax-check
	cd ansible && ansible-playbook inspect-dependencies.yml --syntax-check
	cd ansible && ansible-playbook restore.yml --syntax-check
	cd ansible && ansible-playbook deploy.yml --syntax-check
	cd ansible && ansible-playbook confirm.yml --syntax-check

dependency-audit:
	python3 tools/dependency_audit.py

vendor-deps:
	python3 tools/offline_runtime.py fetch

inspect:
	cd ansible && ansible-playbook inspect.yml --ask-pass

inspect-dependencies:
	cd ansible && ansible-playbook inspect-dependencies.yml --ask-pass

capture:
	@test -n "$(LABEL)" || (echo 'Use make capture LABEL=4.10.0-second-capture'; exit 1)
	python3 tools/capture.py --label "$(LABEL)"

dashboard: package-device

dev-image:
	docker build --platform $(BUILD_PLATFORM) -f dev/Dockerfile -t $(DEV_IMAGE) .

rust-check:
	$(RUST_RUN) 'cargo fmt --manifest-path apps/router-admin/Cargo.toml --check && cargo clippy --locked --manifest-path apps/router-admin/Cargo.toml --all-targets -- -D warnings'

rust-test:
	$(RUST_RUN) 'cargo test --locked --manifest-path apps/router-admin/Cargo.toml'

web-deps:
	mkdir -p .cache/npm
	$(NODE_RUN) npm ci --ignore-scripts

web-build:
	$(NODE_RUN) npm run build

web-test:
	$(NODE_RUN) npm test

web-preview:
	mkdir -p .cache/web-preview
	cp apps/web-ui/preview/index.html .cache/web-preview/index.html
	$(NODE_RUN) npm run preview-build

web-browser-test: web-preview
	docker run --rm --ipc=host -v "$(CURDIR):/workspace:ro" -w /workspace/apps/web-ui $(PLAYWRIGHT_IMAGE) npm run test:browser

web-live-browser-test: web-preview
	docker run --rm --network none -v "$(CURDIR):/workspace:ro" -v e5800-fips-lab_lab_state:/state:ro -w /workspace/apps/web-ui $(PLAYWRIGHT_IMAGE) npm run test:live

web-preview-host:
	mkdir -p .cache/web-preview
	cp apps/web-ui/preview/index.html .cache/web-preview/index.html
	cd apps/web-ui && npm run preview-build

web-preview-serve: web-preview
	python3 -m http.server 8787 --directory .cache/web-preview

web-preview-host-serve: web-preview-host
	python3 -m http.server 8787 --directory .cache/web-preview

lab-build:
	$(RUST_RUN) 'PATH=/workspace/dev/tool-shims:$$PATH cargo build --locked --release --manifest-path components/fips/Cargo.toml --bin fips --bin fipsctl'
	$(RUST_RUN) 'PATH=/workspace/dev/tool-shims:$$PATH cargo build --locked --release --manifest-path apps/router-admin/Cargo.toml --bin fips-router-admin'

lab-up:
	docker compose -f dev/lab/compose.yml up -d --wait --pull never

lab-test:
	docker compose -f dev/lab/compose.yml exec -T node-a python3 /workspace/dev/lab/integration.py
	python3 dev/lab/lifecycle.py

scoped-ipv6-test: lab-build
	docker run --rm --privileged --network none -v "$(CURDIR):/workspace:ro" -w /workspace $(DEV_IMAGE) sh dev/lab/scoped_ipv6.sh

route-lan-test: lab-build
	docker run --rm --privileged --network none -e FIPS_RA_REQUIRE_ROUTE_INFO -v "$(CURDIR):/workspace:ro" -w /workspace $(DEV_IMAGE) python3 dev/lab/route_advertisement.py

lab-down:
	docker compose -f dev/lab/compose.yml down

device-preview:
	python3 dev/device_ui_patch.py .cache/generated-device-ui/dashboard.py
	docker run --rm $(PROJECT_MOUNT) $(DEV_IMAGE) python3 dev/lab/preview_device.py --output /workspace/.cache/fips-panel-offline.png

device-preview-host:
	python3 dev/device_ui_patch.py .cache/generated-device-ui/dashboard.py
	python3 dev/lab/preview_device.py --output .cache/fips-panel-offline-host.png

openwrt-build:
	$(RUST_RUN) 'PATH=/workspace/dev/tool-shims:$$PATH cargo zigbuild --locked --release --target aarch64-unknown-linux-musl --manifest-path components/fips/Cargo.toml --bin fips --bin fipsctl --bin fips-gateway'
	$(RUST_RUN) 'PATH=/workspace/dev/tool-shims:$$PATH cargo zigbuild --locked --release --target aarch64-unknown-linux-musl --manifest-path apps/router-admin/Cargo.toml --bin fips-router-admin'
	mkdir -p .cache/openwrt-bin
	cp components/fips/target/aarch64-unknown-linux-musl/release/fips components/fips/target/aarch64-unknown-linux-musl/release/fipsctl components/fips/target/aarch64-unknown-linux-musl/release/fips-gateway apps/router-admin/target/aarch64-unknown-linux-musl/release/fips-router-admin .cache/openwrt-bin/
	$(RUST_RUN) 'python3 tools/build_provenance.py .cache/openwrt-bin --emit'

package-fips:
	python3 tools/package.py fips --bin-dir .cache/openwrt-bin

package-web:
	python3 tools/package.py web_ui

package-device:
	python3 tools/package.py device_ui
