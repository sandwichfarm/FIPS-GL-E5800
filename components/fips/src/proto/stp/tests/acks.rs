//! Delivery tracking for sent tree announces.
//!
//! Synthetic milliseconds, counters and receiver reports, no I/O. A report is
//! written `(highest, received, reordered)`. Unless a test says otherwise, a
//! send is recorded with `next_counter = counter + 1`, as the shell reads it
//! straight after the send. The shared rule itself (bases, sessions, budgets,
//! backoff, rekey artifacts) is covered by the filter announce tests; these
//! cover what the tree adds: the declaration sequence as the lineage, and
//! removal with the peer.

use super::util::make_node_addr;
use crate::NodeAddr;
use crate::proto::mmp::delivery::{FALLBACK_MS, LinkEvidence, ResendReason, RrCounters};
use crate::proto::stp::TreeState;

/// First session.
const E1: u64 = 0x0e01;
/// Second session.
const E2: u64 = 0x0e02;

/// A report's cumulative counters.
fn rr(highest: u64, received: u64, reordered: u32) -> Option<RrCounters> {
    Some(RrCounters {
        highest,
        received,
        reordered,
    })
}

/// Link evidence for session `epoch`.
fn link(epoch: u64, next_counter: u64, rr: Option<RrCounters>) -> LinkEvidence {
    LinkEvidence {
        epoch,
        next_counter,
        rr,
    }
}

/// One peer's tree announces, driven as the shell drives them.
struct Track {
    state: TreeState,
    peer: NodeAddr,
    counter: u64,
}

impl Track {
    /// A tracker with nothing sent yet.
    fn new() -> Self {
        Self {
            state: TreeState::new(make_node_addr(0), 1000),
            peer: make_node_addr(1),
            counter: 0,
        }
    }

    /// Record a send of declaration sequence `seq` at `counter`.
    fn send(&mut self, seq: u64, counter: u64, link: LinkEvidence, now_ms: u64) {
        self.state
            .record_announce(self.peer, seq, counter, &link, now_ms);
        self.counter = counter;
    }

    /// One tick of the tracker.
    fn check(&mut self, link: LinkEvidence, now_ms: u64) -> Option<ResendReason> {
        self.state.check_announce(&self.peer, &link, now_ms)
    }

    /// Whether the announce is still unconfirmed.
    fn outstanding(&self) -> bool {
        self.state.announce_outstanding(&self.peer)
    }

    /// Check every 1,000 ms from `from_ms` to `to_ms` inclusive, recording
    /// each resend as a send of `seq`, as the shell resends the current
    /// declaration. `model` gives the evidence at a time, from the
    /// outstanding counter: for a check with `false`, and for recording a
    /// resend with `true`, where the resend takes the counter
    /// `next_counter - 1` of that evidence. Returns the resends.
    fn hold(
        &mut self,
        seq: u64,
        from_ms: u64,
        to_ms: u64,
        model: impl Fn(u64, bool) -> LinkEvidence,
    ) -> Vec<(u64, ResendReason)> {
        let mut resends = Vec::new();
        let mut now = from_ms;
        while now <= to_ms {
            if let Some(reason) = self.check(model(self.counter, false), now) {
                resends.push((now, reason));
                let ev = model(self.counter, true);
                self.send(seq, ev.next_counter - 1, ev, now);
            }
            now += 1_000;
        }
        resends
    }
}

/// Loss on every check: each send is based on a report just below it, and
/// each check sees a report two counters on with one frame missing.
fn lossy(counter: u64, recording: bool) -> LinkEvidence {
    if recording {
        let n = counter + 1;
        link(E1, n + 1, rr(n - 1, n, 0))
    } else {
        link(E1, counter + 2, rr(counter + 1, counter + 1, 0))
    }
}

/// Send sequence 5 into a lossy link and spend its three loss resends.
///
/// The resends are checked but not recorded, so spending the budget does not
/// depend on the lineage decision; the one record each test then makes is
/// the only lineage decision it observes. The window ends before the
/// backoff would allow a fourth resend (7 s), so the budget limit itself is
/// observed only by the test's final assertion.
fn spend_budget() -> Track {
    let mut t = Track::new();
    t.send(5, 12, lossy(11, true), 0);
    let mut resends = Vec::new();
    for now in (0..=6_000).step_by(1_000) {
        if let Some(reason) = t.check(lossy(12, false), now) {
            resends.push((now, reason));
        }
    }
    assert_eq!(
        resends,
        vec![
            (0, ResendReason::Loss),
            (1_000, ResendReason::Loss),
            (3_000, ResendReason::Loss),
        ],
        "setup: the lineage spends its three loss resends"
    );
    assert!(
        t.outstanding(),
        "setup: the lost announce is still outstanding"
    );
    t
}

/// A new declaration sequence starts a new lineage, whose loss budget is
/// full again.
#[test]
fn test_tree_ack_new_sequence_starts_a_new_lineage() {
    let mut t = spend_budget();
    let c = t.counter;
    t.send(6, c + 1, lossy(c, true), 10_000);
    assert_eq!(
        t.check(lossy(t.counter, false), 11_000),
        Some(ResendReason::Loss),
        "a new sequence must refill the loss budget"
    );
}

/// The periodic re-broadcast sends the same sequence again, so it stays in
/// the lineage and does not refill the loss budget; the one unchecked
/// resend still comes, 30 s after the re-broadcast.
#[test]
fn test_tree_ack_periodic_resend_of_the_same_sequence_keeps_the_budget() {
    let mut t = spend_budget();
    let c = t.counter;
    t.send(5, c + 1, lossy(c, true), 10_000);
    let resends = t.hold(5, 11_000, 120_000, lossy);
    assert_eq!(
        resends,
        vec![(10_000 + FALLBACK_MS, ResendReason::Timeout)],
        "no fourth loss resend, and exactly one unchecked resend"
    );
}

/// Removing the peer forgets its announce, so the next send starts a fresh
/// entry whose first session measures from counter zero.
#[test]
fn test_tree_ack_removed_peer_starts_fresh() {
    // Control: without the removal, an announce in a later session with no
    // report has no base, and a first report already covering it cannot
    // check it.
    let mut t = Track::new();
    t.send(5, 12, link(E1, 13, rr(9, 10, 0)), 0);
    t.send(5, 3, link(E2, 4, None), 1_000);
    assert_eq!(
        t.check(link(E2, 4, rr(3, 4, 0)), 2_000),
        Some(ResendReason::Unverified),
        "control: the kept entry cannot check the announce"
    );

    let mut t = Track::new();
    t.send(5, 12, link(E1, 13, rr(9, 10, 0)), 0);
    t.state.remove_peer(&t.peer);
    assert!(!t.outstanding(), "removal must forget the announce");
    t.send(5, 3, link(E2, 4, None), 1_000);
    assert_eq!(t.check(link(E2, 4, rr(3, 4, 0)), 2_000), None);
    assert!(!t.outstanding(), "the new entry must measure from zero");
}

/// In the peer's first session with no report before the send, frames that
/// arrive out of order are still every counter from 0, so the announce
/// confirms. This is the traced shape of a tree announce and a filter
/// announce sent in the same tick arriving swapped.
#[test]
fn test_tree_ack_in_window_reorder_on_the_zero_base_confirms() {
    let mut t = Track::new();
    t.send(5, 3, link(E1, 4, None), 0);
    // 0..=4 all arrived, two of them after a higher counter.
    assert_eq!(t.check(link(E1, 5, rr(4, 5, 2)), 1_000), None);
    assert!(
        !t.outstanding(),
        "every counter arrived, so it must confirm"
    );
}

/// A covering report whose receipts since the base fall short of the span is
/// a loss, and the announce stays outstanding.
#[test]
fn test_tree_ack_short_upper_bound_is_a_loss() {
    let mut t = Track::new();
    // Base (9, 10, 0): all of 0..=9 counted.
    t.send(5, 12, link(E1, 13, rr(9, 10, 0)), 0);
    // Four of 10..=14 arrived.
    assert_eq!(
        t.check(link(E1, 15, rr(14, 14, 0)), 1_000),
        Some(ResendReason::Loss)
    );
    assert!(t.outstanding(), "a lost announce stays outstanding");
}

/// With no report ever, the announce gets its one unchecked resend exactly
/// at the default fallback, and none after.
#[test]
fn test_tree_ack_fallback_resends_once_per_lineage() {
    let mut t = Track::new();
    t.send(5, 12, link(E1, 13, None), 0);
    assert_eq!(t.check(link(E1, 13, None), FALLBACK_MS - 1), None);
    assert!(t.outstanding());
    let quiet = |c: u64, recording: bool| link(E1, c + if recording { 2 } else { 1 }, None);
    let resends = t.hold(5, FALLBACK_MS, 120_000, quiet);
    assert_eq!(resends, vec![(FALLBACK_MS, ResendReason::Timeout)]);
    assert_eq!(FALLBACK_MS, 30_000);
}
