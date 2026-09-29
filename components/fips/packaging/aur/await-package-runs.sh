#!/usr/bin/env bash
# Wait until every package workflow run for a release tag has succeeded.
#
# The AUR publish job runs this before it pushes a new pkgver, so the AUR never
# points at a tag whose release assets are still uploading or failed to build.
# Each package-*.yml workflow uploads its assets from a `release` job inside
# the same run, so a successful tag run means that workflow's assets are up.
#
# The population is discovered from the checked-out tree rather than listed
# here: the package-*.yml files at the tag are the workflows the tag push
# triggered. Finding none is a failure, never a pass.
#
# A tag push and the branch push of the same commit each start a run with the
# same head_sha; only the tag run carries the tag name in head_branch, so runs
# are matched on both. If the tag was re-pushed at the same commit, the newest
# matching run decides.
#
# Required environment variables:
#   GITHUB_REPOSITORY - owner/repo
#   TAG               - release tag (e.g. v0.5.1)
#   SHA               - the commit the tag points at
#   GH_TOKEN          - token with actions:read (read by gh; not checked here)
# Optional:
#   WORKFLOW_DIR   - where to discover package-*.yml (default .github/workflows)
#   AWAIT_POLLS    - number of polls before giving up (default 60)
#   AWAIT_INTERVAL - seconds between polls (default 60)
#   DISCOVER_ONLY  - if set to 1, print the discovered workflows and exit
#
# Exit status: 0 when every discovered workflow has a successful tag run;
# 1 at once when a tag run concludes anything but success; 1 when the poll
# budget runs out with any workflow unobserved, not finished, or unreadable.

set -euo pipefail

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
: "${TAG:?TAG must be set}"
: "${SHA:?SHA must be set}"
WORKFLOW_DIR="${WORKFLOW_DIR:-.github/workflows}"
AWAIT_POLLS="${AWAIT_POLLS:-60}"
AWAIT_INTERVAL="${AWAIT_INTERVAL:-60}"

# How to recover once the cause of a failure is fixed. A workflow_dispatch run
# of a package workflow is not a push run of the tag and never satisfies this
# gate; re-running the failed jobs of the tag's own run keeps it one.
RECOVERY="If a run failed: use \"Re-run failed jobs\" on the package workflow's run for $TAG \
(a new workflow_dispatch run does not count), then re-run the AUR Publish job for $TAG."

# Print the basenames of the package workflows found in WORKFLOW_DIR.
discover() {
  local f
  for f in "$WORKFLOW_DIR"/package-*.yml; do
    [ -e "$f" ] && basename "$f"
  done
  return 0
}

# Print "<status> <conclusion> <html_url>" for the newest push run of TAG at
# SHA for one workflow, or "none" if there is no such run yet. On an API or
# parse failure, print the error text and return nonzero.
latest() {
  local wf=$1 body
  if ! body=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$wf/runs?head_sha=$SHA&event=push&per_page=100" 2>"$ERRS"); then
    tr '\n' ' ' < "$ERRS"
    return 1
  fi
  printf '%s\n' "$body" | jq -er --arg tag "$TAG" --arg sha "$SHA" '
    [.workflow_runs[]
      | select(.head_branch == $tag and .head_sha == $sha and .event == "push")]
    | sort_by(.created_at)
    | if length == 0 then "none"
      else last | "\(.status) \(.conclusion // "none") \(.html_url)" end' 2>&1
}

mapfile -t pending < <(discover)
if [ "${#pending[@]}" -eq 0 ]; then
  echo "No package-*.yml workflows found in $WORKFLOW_DIR; refusing to treat an empty set as done" >&2
  exit 1
fi
if [ "${DISCOVER_ONLY:-}" = 1 ]; then
  printf '%s\n' "${pending[@]}"
  exit 0
fi

ERRS=$(mktemp)
trap 'rm -f "$ERRS"' EXIT

echo "Waiting for $TAG ($SHA) runs of: ${pending[*]}"
declare -A seen
for ((poll = 1; poll <= AWAIT_POLLS; poll++)); do
  still=()
  for wf in "${pending[@]}"; do
    if ! state=$(latest "$wf"); then
      seen[$wf]="API error: $state"
      still+=("$wf")
      continue
    fi
    seen[$wf]=$state
    read -r status conclusion url <<< "$state"
    case "$status" in
      none)
        # The tag run has not been created yet.
        still+=("$wf") ;;
      completed)
        if [ "$conclusion" = success ]; then
          echo "$wf: succeeded ($url)"
        else
          echo "$wf: run for $TAG concluded '$conclusion' ($url); not publishing to the AUR" >&2
          echo "$RECOVERY" >&2
          exit 1
        fi ;;
      *)
        # queued, in_progress, waiting, requested or pending.
        still+=("$wf") ;;
    esac
  done
  pending=("${still[@]}")
  if [ "${#pending[@]}" -eq 0 ]; then
    echo "Every package workflow run for $TAG has succeeded"
    exit 0
  fi
  echo "Poll $poll/$AWAIT_POLLS: waiting on ${pending[*]}"
  if [ "$poll" -lt "$AWAIT_POLLS" ]; then sleep "$AWAIT_INTERVAL"; fi
done

echo "Gave up after $AWAIT_POLLS polls; not publishing to the AUR. Still unfinished:" >&2
for wf in "${pending[@]}"; do
  echo "  $wf: ${seen[$wf]}" >&2
done
echo "If a run is still going, re-run the AUR Publish job for $TAG once it has succeeded." >&2
echo "$RECOVERY" >&2
exit 1
