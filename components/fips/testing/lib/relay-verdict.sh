#!/bin/bash
# Shared relay verdict for the NAT-lab suites.
#
# Source this file to get relay_verdict().
#
# Usage:
#   source "$ROOT_DIR/testing/lib/relay-verdict.sh"
#   relay_verdict <relay-container>
#
# The lab's Nostr relay is a third-party container (strfry), and it has died
# mid-run: once on a SIGSEGV twelve milliseconds after both nodes had
# connected, and several times since on an internal assertion that aborts it
# the instant two clients connect together. Every symptom under that is a
# correct report of a dead relay: subscriptions dropped, no advert consumed,
# empty peer lists, and a run that fails on the peer-count wait. That verdict
# is indistinguishable from a product failure unless the relay's state is
# stated, and the only evidence of the real cause was one container-log line
# far above the summary. relay_verdict says whose failure it was, in a line a
# reader of the output can find.

# State the relay's own condition, in its own words.
#
# This does not decide the run. It returns 0 when the run had a relay event
# (the relay is gone, not running, restarted, faulted, or its health could not
# be read) and 1 when the relay was running with no fault in its log. Callers
# use it first in a failure dump, and on the success path to note a relay
# event the assertions survived.
#
# A relay whose state or log cannot be read has not been shown to be healthy,
# so that case is reported as unestablished rather than as "not the relay".
relay_verdict() {
    local container="$1"
    local state="" status="" exit_code="" restarts="" logs=""
    local faults="caught a signal|SIGSEGV|SIGABRT|terminate called"

    state="$(docker inspect \
        -f '{{.State.Status}} {{.State.ExitCode}} {{.RestartCount}}' \
        "$container" 2>/dev/null)" || state=""

    if [ -z "$state" ]; then
        echo "RELAY FAILURE: $container is gone; whatever this run" \
             "asserted about peering happened without a relay" >&2
        return 0
    fi

    read -r status exit_code restarts <<<"$state"

    if [ "$status" != "running" ]; then
        echo "RELAY FAILURE: $container is $status (exit $exit_code);" \
             "the assertions in this run are downstream of that, not of the" \
             "nodes" >&2
        return 0
    fi

    # docker logs spans every restart of the same container, so the fault
    # lines of the run that died are still readable here.
    if [ "${restarts:-0}" -gt 0 ]; then
        echo "RELAY FAILURE: $container restarted $restarts time(s) during" \
             "this run under its restart policy; the nodes lost their" \
             "subscriptions each time and had to reconnect" >&2
        if logs="$(docker logs "$container" 2>&1)"; then
            grep -E "$faults" <<<"$logs" >&2 || true
        else
            echo "  (its logs could not be read, so the fault lines are" \
                 "not shown)" >&2
        fi
        return 0
    fi

    if ! logs="$(docker logs "$container" 2>&1)"; then
        echo "RELAY HEALTH NOT ESTABLISHED: could not read" \
             "$container's logs, so a crash cannot be ruled in or out" >&2
        return 0
    fi

    if grep -Eq "$faults" <<<"$logs"; then
        echo "RELAY FAILURE: $container faulted during this run:" >&2
        grep -E "$faults" <<<"$logs" >&2
        return 0
    fi

    echo "relay: $container running, no fault in its log — this run's" \
         "verdict is about the nodes"
    return 1
}
