//! Delivery of announces, inferred from the link's receiver reports.
//!
//! The transport accepting a frame is not delivery: a datagram can still be
//! lost. An announce is therefore held as outstanding until the peer's
//! ReceiverReports show that every link counter since a base, up to and
//! including the announce's own, arrived. The reports carry cumulative
//! counts, so the evidence has an upper and a lower bound:
//!
//! - loss is concluded only when the upper bound, all receipts since the
//!   base, falls short of the span of counters;
//! - delivery is concluded only when the lower bound, the receipts that were
//!   not reorders, equals the span, or when all receipts equal the span on a
//!   base known to have no holes;
//! - the gap between the two bounds is no evidence either way.
//!
//! A report whose highest counter is at or above the session's next send
//! counter describes another session and is no evidence. An announce the
//! reports cannot check gets one unchecked resend; loss and unchecked
//! resends are bounded per announce lineage per session and spaced by a
//! per-peer backoff.
//!
//! Sans-IO: time is injected as `u64` milliseconds and the shell supplies
//! the link counters, so nothing here reads a clock or touches a socket.

use alloc::collections::BTreeMap;

use crate::NodeAddr;

/// How long an announce the receiver reports cannot check waits before its
/// one unchecked resend, in milliseconds. Equal to the default link dead
/// timeout, so an outage that did not remove the peer has ended by then.
pub const FALLBACK_MS: u64 = 30_000;

/// The largest gap the per-peer resend backoff imposes, in milliseconds.
pub const MAXGAP_MS: u64 = 60_000;

/// A run of resends with no resend for this long, in milliseconds, resets the
/// backoff. It must exceed [`MAXGAP_MS`], or a sustained trigger resending at
/// the largest gap would reset its own backoff every time.
pub const QUIET_MS: u64 = 120_000;

/// Unchecked resends (`Unverified`, `SessionChanged` or `Timeout`) allowed per
/// announce lineage per session.
pub const UNVERIFIED_BUDGET: u8 = 1;

/// Resends on reported loss allowed per announce lineage per session.
pub const LOSS_BUDGET: u8 = 3;

/// Highest backoff level. `gap` at this level is already capped at
/// [`MAXGAP_MS`], so a higher level would add nothing; the cap keeps the
/// shift in range.
const MAX_LEVEL: u8 = 7;

/// The cumulative counters of one ReceiverReport the peer sent about our
/// frames on a link.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RrCounters {
    /// Highest link counter the peer had received from us.
    pub highest: u64,
    /// Link frames from us the peer had counted, cumulative.
    pub received: u64,
    /// Of those, frames that arrived below the highest counter, cumulative.
    pub reordered: u32,
}

/// What the shell reads from one peer's link at one moment, for deciding
/// whether an announce reached that peer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LinkEvidence {
    /// Identity of the current link session (from its handshake hash). The
    /// send counter restarts at 0 in every session, so counters are compared
    /// only within one epoch.
    pub epoch: u64,
    /// The next send counter the current session will use.
    pub next_counter: u64,
    /// The last ReceiverReport accepted in the current session, if any.
    pub rr: Option<RrCounters>,
}

impl LinkEvidence {
    /// The report, when it can describe the current session.
    ///
    /// The peer cannot have received a counter this session has not used yet,
    /// so a report whose highest counter is at or above `next_counter`
    /// describes another session. That happens briefly around a rekey, when a
    /// report or frame of the old session is counted against the new one, and
    /// such a report is no evidence either way.
    pub fn usable_rr(&self) -> Option<RrCounters> {
        self.rr.filter(|rr| rr.highest < self.next_counter)
    }
}

/// Why an announce is being resent, for the shell's log line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResendReason {
    /// A report covering the announce shows fewer frames arrived since its
    /// base than were sent.
    Loss,
    /// The first usable report already covers an announce it cannot check.
    Unverified,
    /// The announce was sent on an earlier session and cannot be checked.
    SessionChanged,
    /// No usable report checked the announce within the fallback interval.
    Timeout,
}

/// What an announce's delivery is measured from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Base {
    /// The last usable report before the announce was sent, and whether it
    /// has no holes: every counter up to its highest had arrived.
    Counted(RrCounters, bool),
    /// Nothing received yet in the peer's first session: every counter from 0
    /// must arrive.
    Zero,
    /// No base: a later report can become one if it does not yet cover the
    /// announce.
    Unknown,
}

/// The one announce to a peer still awaiting confirmation.
#[derive(Clone, Copy, Debug)]
struct SentAnnounce {
    /// Link counter the announce was sent with.
    counter: u64,
    /// Session the counter belongs to (or, once orphaned, the session that
    /// orphaned it).
    epoch: u64,
    /// What delivery is measured from.
    base: Base,
    /// Sent on an earlier session, so it can never be checked.
    orphan: bool,
    /// When it was sent or orphaned, for the fallback.
    at_ms: u64,
}

/// Per-peer delivery tracking for sent announces.
#[derive(Clone, Debug)]
struct AckState {
    /// Session in which this entry was created; only there does a missing
    /// report mean the peer has received nothing yet.
    first_epoch: u64,
    /// The outstanding announce, if one is unconfirmed.
    sent: Option<SentAnnounce>,
    /// Backoff level: the number of resends in the current run, capped.
    level: u8,
    /// When the last resend was triggered.
    resent_ms: Option<u64>,
    /// Session the budgets were last refilled for.
    budget_epoch: u64,
    /// Unchecked resends left for the current lineage in this session.
    unverified_left: u8,
    /// Loss resends left for the current lineage in this session.
    loss_left: u8,
}

impl AckState {
    /// A fresh entry for a peer first sent to in session `epoch`.
    fn new(epoch: u64) -> Self {
        Self {
            first_epoch: epoch,
            sent: None,
            level: 0,
            resent_ms: None,
            budget_epoch: epoch,
            unverified_left: UNVERIFIED_BUDGET,
            loss_left: LOSS_BUDGET,
        }
    }

    /// Refill both budgets for session `epoch`.
    fn refill(&mut self, epoch: u64) {
        self.budget_epoch = epoch;
        self.unverified_left = UNVERIFIED_BUDGET;
        self.loss_left = LOSS_BUDGET;
    }

    /// Whether report `rr`, taken in session `epoch`, shows no holes: every
    /// counter up to its highest had arrived. Only in the peer's first session
    /// does its cumulative count start at 0, so a later session's report is
    /// never known to be whole.
    fn whole(&self, epoch: u64, rr: RrCounters) -> bool {
        epoch == self.first_epoch && rr.highest.checked_add(1) == Some(rr.received)
    }

    /// Whether the backoff allows a resend at `now_ms`, resetting the level
    /// after a quiet period.
    fn backoff_allows(&mut self, now_ms: u64) -> bool {
        let Some(last) = self.resent_ms else {
            return true;
        };
        if now_ms >= last.saturating_add(QUIET_MS) {
            self.level = 0;
        }
        now_ms >= last.saturating_add(gap(self.level))
    }
}

/// Minimum time after a resend before the next one, at backoff `level`.
fn gap(level: u8) -> u64 {
    match level {
        0 => 0,
        n => (1000u64 << (n.min(MAX_LEVEL) - 1)).min(MAXGAP_MS),
    }
}

/// Whether every counter in the report's range since `base` arrived.
///
/// Within one receiver epoch every frame counted between two reports is a
/// distinct counter at or below `h1`. Those in `(h0, h1]` number at most all
/// receipts, `got`, and at least the non-reorder receipts, `sure`: a frame
/// that arrived after a higher counter is a reorder whether its counter lies
/// inside the window or at or below `h0`.
///
/// - `got` below the span is a loss: fewer frames arrived than the window
///   holds.
/// - `sure` equal to the span is delivery.
/// - `got` equal to the span is delivery when the base has no holes, since
///   then no counter at or below `h0` is left to arrive late.
///
/// Anything else is ambiguous and proves nothing, as is an inconsistent pair
/// (a counter went backwards), which means the two reports straddle a
/// receiver reset or another session's frame. Frames reserved but never
/// sent and frames dropped before counting only lower the counts, so a lost
/// frame is confirmed only if the peer overcounts.
fn delivered(base: Base, rr: RrCounters) -> Option<bool> {
    let (r0, o0, span, complete) = match base {
        Base::Counted(b, complete) => (
            b.received,
            b.reordered,
            rr.highest.checked_sub(b.highest)?,
            complete,
        ),
        Base::Zero => (0, 0, rr.highest.checked_add(1)?, true),
        Base::Unknown => return None,
    };
    let got = rr.received.checked_sub(r0)?;
    let sure = got.checked_sub(u64::from(rr.reordered.checked_sub(o0)?))?;
    if got < span {
        Some(false)
    } else if sure == span || (complete && got == span) {
        Some(true)
    } else {
        None
    }
}

/// Delivery tracking for one kind of announce, per peer.
///
/// Each kind of announce keeps its own instance, so the budgets and the
/// backoff of one kind never hold back the other.
#[derive(Clone, Debug)]
pub struct Acks {
    /// How long an unchecked announce waits for its fallback resend (ms).
    fallback_ms: u64,
    /// Per-peer delivery tracking for sent announces.
    peers: BTreeMap<NodeAddr, AckState>,
}

impl Default for Acks {
    fn default() -> Self {
        Self::new()
    }
}

impl Acks {
    /// Tracking with no peer and the default fallback, [`FALLBACK_MS`].
    pub fn new() -> Self {
        Self {
            fallback_ms: FALLBACK_MS,
            peers: BTreeMap::new(),
        }
    }

    /// Set how long an announce the receiver reports cannot check waits
    /// before its fallback resend.
    pub fn set_fallback(&mut self, ms: u64) {
        self.fallback_ms = ms;
    }

    /// Record an announce the transport accepted for `peer`, sent with link
    /// counter `counter`, so it stays outstanding until the peer's receiver
    /// reports show it arrived.
    ///
    /// `fresh` says the announce starts a new lineage (new content), which
    /// refills its resend budgets. The budgets also refill when the session
    /// changes, and never otherwise, so a resend of the same content spends
    /// from its lineage's budget.
    pub fn record(
        &mut self,
        peer: NodeAddr,
        fresh: bool,
        counter: u64,
        link: &LinkEvidence,
        now_ms: u64,
    ) {
        let ack = self
            .peers
            .entry(peer)
            .or_insert_with(|| AckState::new(link.epoch));
        if fresh || link.epoch != ack.budget_epoch {
            ack.refill(link.epoch);
        }
        // With no report yet, the zero baseline holds only in the peer's first
        // session: a later session's cumulative count includes earlier ones.
        let base = match link.usable_rr() {
            Some(rr) if rr.highest < counter => Base::Counted(rr, ack.whole(link.epoch, rr)),
            _ if link.rr.is_none() && link.epoch == ack.first_epoch => Base::Zero,
            _ => Base::Unknown,
        };
        ack.sent = Some(SentAnnounce {
            counter,
            epoch: link.epoch,
            base,
            orphan: false,
            at_ms: now_ms,
        });
    }

    /// Decide whether the outstanding announce to `peer` must be resent.
    ///
    /// Confirms the announce when a usable report covering its counter shows
    /// every counter since its base arrived. Resends on a covering report that
    /// shows a loss; once, as soon as a usable report arrives, for an announce
    /// the reports cannot check; and once after the fallback interval when no
    /// usable report checks it. A usable report that does not yet cover an
    /// announce sent in the current session becomes its base instead of
    /// triggering a resend. A report from another session, or a pair of
    /// reports that is inconsistent or cannot tell a late frame from before
    /// the base from one inside the window, is no evidence. Each announce lineage
    /// gets [`UNVERIFIED_BUDGET`] unchecked and [`LOSS_BUDGET`] loss resends
    /// per session, and a per-peer backoff spaces all resends by 1, 2, 4 ...
    /// up to 60 s until [`QUIET_MS`] passes with none.
    ///
    /// On `Some`, the caller must arrange the resend; nothing is marked here.
    pub fn check(
        &mut self,
        peer: &NodeAddr,
        link: &LinkEvidence,
        now_ms: u64,
    ) -> Option<ResendReason> {
        let fallback_ms = self.fallback_ms;
        let ack = self.peers.get_mut(peer)?;
        let mut sent = ack.sent?;

        if link.epoch != ack.budget_epoch {
            ack.refill(link.epoch);
        }
        if sent.epoch != link.epoch {
            sent.orphan = true;
            sent.epoch = link.epoch;
            sent.base = Base::Unknown;
            sent.at_ms = now_ms;
        }
        ack.sent = Some(sent);

        let rr = link.usable_rr();
        let due = now_ms >= sent.at_ms.saturating_add(fallback_ms);
        let candidate = match (sent.base, rr) {
            (Base::Unknown, Some(rr)) => {
                if !sent.orphan && rr.highest < sent.counter {
                    sent.base = Base::Counted(rr, ack.whole(link.epoch, rr));
                    ack.sent = Some(sent);
                    return None;
                }
                Some(if sent.orphan {
                    ResendReason::SessionChanged
                } else {
                    ResendReason::Unverified
                })
            }
            (Base::Unknown, None) => due.then_some(ResendReason::Timeout),
            (base, rr) => {
                let covering = rr.filter(|rr| rr.highest >= sent.counter);
                let loss = match covering.and_then(|rr| delivered(base, rr)) {
                    Some(true) => {
                        ack.sent = None;
                        return None;
                    }
                    Some(false) if ack.loss_left > 0 => Some(ResendReason::Loss),
                    _ => None,
                };
                loss.or(due.then_some(ResendReason::Timeout))
            }
        }?;

        let loss = candidate == ResendReason::Loss;
        let left = if loss {
            ack.loss_left
        } else {
            ack.unverified_left
        };
        if left == 0 || !ack.backoff_allows(now_ms) {
            return None;
        }
        if loss {
            ack.loss_left -= 1;
        } else {
            ack.unverified_left -= 1;
        }
        ack.level = (ack.level + 1).min(MAX_LEVEL);
        ack.resent_ms = Some(now_ms);
        Some(candidate)
    }

    /// The link counter of the announce to `peer` awaiting confirmation.
    pub fn outstanding(&self, peer: &NodeAddr) -> Option<u64> {
        self.peers.get(peer)?.sent.map(|sent| sent.counter)
    }

    /// Forget everything about `peer`, which was removed.
    pub fn remove(&mut self, peer: &NodeAddr) {
        self.peers.remove(peer);
    }
}
