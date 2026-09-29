.PHONY: check inspect capture dashboard

check:
	python3 -m unittest discover -s tests -v
	cd ansible && ansible-playbook inspect.yml --syntax-check
	cd ansible && ansible-playbook restore.yml --syntax-check

inspect:
	cd ansible && ansible-playbook inspect.yml --ask-pass

capture:
	@test -n "$(LABEL)" || (echo 'Use make capture LABEL=4.10.0-second-capture'; exit 1)
	python3 tools/capture.py --label "$(LABEL)"

dashboard:
	sh components/device-ui/packages/build.sh
	cp components/device-ui/packages/gl-e5800-dashboard_*.ipk artifacts/
