DEV_IMAGE := e5800-dev:0.2.0
NODE_IMAGE := node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34
PROJECT_MOUNT := -v "$(CURDIR):/workspace" -w /workspace
RUST_RUN := docker run --rm -e SOURCE_DATE_EPOCH=1788220800 $(PROJECT_MOUNT) -v "$(CURDIR)/.cache/cargo-registry:/usr/local/cargo/registry" $(DEV_IMAGE) sh -c

.PHONY: check inspect capture dashboard dev-image web-deps web-build web-test \
        lab-build lab-up lab-test lab-down device-preview openwrt-build \
        package-fips package-web package-device

check:
	python3 -m unittest discover -s tests -v
	cd ansible && ansible-playbook inspect.yml --syntax-check
	cd ansible && ansible-playbook restore.yml --syntax-check
	cd ansible && ansible-playbook deploy.yml --syntax-check

inspect:
	cd ansible && ansible-playbook inspect.yml --ask-pass

capture:
	@test -n "$(LABEL)" || (echo 'Use make capture LABEL=4.10.0-second-capture'; exit 1)
	python3 tools/capture.py --label "$(LABEL)"

dashboard: package-device

dev-image:
	docker build -f dev/Dockerfile -t $(DEV_IMAGE) .

web-deps:
	docker run --rm --user "$(shell id -u):$(shell id -g)" $(PROJECT_MOUNT) -w /workspace/apps/web-ui $(NODE_IMAGE) npm ci --ignore-scripts

web-build:
	docker run --rm --user "$(shell id -u):$(shell id -g)" $(PROJECT_MOUNT) -w /workspace/apps/web-ui $(NODE_IMAGE) npm run build

web-test:
	docker run --rm --user "$(shell id -u):$(shell id -g)" $(PROJECT_MOUNT) -w /workspace/apps/web-ui $(NODE_IMAGE) npm test

lab-build:
	$(RUST_RUN) 'PATH=/workspace/dev/tool-shims:$$PATH cargo build --locked --release --manifest-path components/fips/Cargo.toml --bin fips --bin fipsctl'
	$(RUST_RUN) 'PATH=/workspace/dev/tool-shims:$$PATH cargo build --locked --release --manifest-path apps/router-admin/Cargo.toml --bin fips-router-admin'

lab-up:
	docker compose -f dev/lab/compose.yml up -d --wait

lab-test:
	docker compose -f dev/lab/compose.yml exec -T node-a python3 /workspace/dev/lab/integration.py
	python3 dev/lab/lifecycle.py

lab-down:
	docker compose -f dev/lab/compose.yml down

device-preview:
	python3 dev/device_ui_patch.py .cache/generated-device-ui/dashboard.py
	docker run --rm $(PROJECT_MOUNT) $(DEV_IMAGE) python3 dev/lab/preview_device.py --output /workspace/.cache/fips-panel-offline.png

openwrt-build:
	$(RUST_RUN) 'PATH=/workspace/dev/tool-shims:$$PATH cargo zigbuild --locked --release --target aarch64-unknown-linux-musl --manifest-path components/fips/Cargo.toml --bin fips --bin fipsctl --bin fips-gateway'
	$(RUST_RUN) 'PATH=/workspace/dev/tool-shims:$$PATH cargo zigbuild --locked --release --target aarch64-unknown-linux-musl --manifest-path apps/router-admin/Cargo.toml --bin fips-router-admin'
	mkdir -p .cache/openwrt-bin
	cp components/fips/target/aarch64-unknown-linux-musl/release/fips components/fips/target/aarch64-unknown-linux-musl/release/fipsctl components/fips/target/aarch64-unknown-linux-musl/release/fips-gateway apps/router-admin/target/aarch64-unknown-linux-musl/release/fips-router-admin .cache/openwrt-bin/

package-fips:
	python3 tools/package.py fips --bin-dir .cache/openwrt-bin

package-web:
	python3 tools/package.py web_ui

package-device:
	python3 tools/package.py device_ui
