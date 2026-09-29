//! Bloom filter announce send/receive logic.
//!
//! Handles building, sending, and receiving FilterAnnounce messages,
//! including debounced propagation to peers.

use crate::NodeAddr;
use crate::proto::bloom::BloomFilter;
use crate::proto::bloom::FilterAnnounce;
use crate::proto::mmp::delivery::{LinkEvidence, RrCounters};

use super::reject::BloomReject;
use super::{Node, NodeError};
use std::collections::BTreeMap;
use tracing::{debug, warn};

impl Node {
    /// Collect inbound filters from all peers for outgoing filter computation.
    ///
    /// Returns a map of (peer_node_addr -> filter) for peers that
    /// have sent us a FilterAnnounce.
    pub(super) fn peer_inbound_filters(&self) -> BTreeMap<NodeAddr, BloomFilter> {
        let mut filters = BTreeMap::new();
        for (addr, peer) in &self.peers {
            if self.is_tree_peer(addr)
                && let Some(filter) = peer.inbound_filter()
            {
                filters.insert(*addr, filter.clone());
            }
        }
        filters
    }

    /// Send a FilterAnnounce to a specific peer, respecting debounce.
    ///
    /// `filter` is the outgoing filter for this peer, already computed
    /// with the destination peer's own contribution excluded to prevent
    /// routing loops (don't tell a peer about destinations reachable
    /// only through them).
    ///
    /// If the peer is rate-limited, the update stays pending for
    /// delivery on the next tick cycle.
    pub(super) async fn send_filter_announce_to_peer(
        &mut self,
        peer_addr: &NodeAddr,
        filter: BloomFilter,
    ) -> Result<(), NodeError> {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        // Check debounce
        if !self.bloom_state.should_send_update(peer_addr, now_ms) {
            self.metrics().bloom.debounce_suppressed.inc();
            // Either not pending or rate-limited; will retry on tick
            return Ok(());
        }

        // Build and encode
        let announce = FilterAnnounce::new(filter, self.bloom_state.next_sequence());
        let sent_filter = announce.filter.clone();
        let encoded = announce.encode().map_err(|e| NodeError::SendFailed {
            node_addr: *peer_addr,
            reason: format!("FilterAnnounce encode failed: {}", e),
        })?;

        // Send
        if let Err(e) = self.send_encrypted_link_message(peer_addr, &encoded).await {
            self.metrics().bloom.send_failed.inc();
            return Err(e);
        }

        self.metrics().bloom.sent.inc();

        // Read after the send: anything else taking a counter in between only
        // makes the recorded counter higher, which delays confirmation rather
        // than confirming a frame that was never covered.
        if let Some(link) = self.link_evidence(peer_addr) {
            let counter = link.next_counter.saturating_sub(1);
            self.bloom_state.record_announce(
                *peer_addr,
                &sent_filter,
                counter,
                &link,
                crate::time::mono_ms(),
            );
        }

        // Self-plausibility check: WARN if our own outgoing filter is
        // above the antipoison cap. Independent detection signal if
        // aggregation drift or an ingress-check bypass pushes us over
        // despite M1. Rate-limited to once per 60s globally — outgoing
        // cadence can be per-tick during churn, and we want the
        // operator to see one clear message, not spam.
        let max_fpr = self.config().node.bloom.max_inbound_fpr;
        let out_fill = sent_filter.fill_ratio();
        let out_fpr = sent_filter.fpr();
        if out_fpr > max_fpr {
            let now = std::time::Instant::now();
            let should_warn = self
                .last_self_warn
                .map(|t| now.duration_since(t) >= std::time::Duration::from_secs(60))
                .unwrap_or(true);
            if should_warn {
                self.last_self_warn = Some(now);
                warn!(
                    to = %self.peer_display_name(peer_addr),
                    fill = format_args!("{:.3}", out_fill),
                    fpr = format_args!("{:.4}", out_fpr),
                    cap = format_args!("{:.4}", max_fpr),
                    "Outgoing filter above FPR cap — aggregation drift or missed ingress?"
                );
            }
        }

        // Record send and store the filter for change detection
        debug!(
            peer = %self.peer_display_name(peer_addr),
            seq = announce.sequence,
            est_entries = match sent_filter.estimated_count(max_fpr) {
                Some(n) => format!("{:.0}", n),
                None => "—".to_string(),
            },
            set_bits = sent_filter.count_ones(),
            fill = format_args!("{:.1}%", sent_filter.fill_ratio() * 100.0),
            tree_peer = self.is_tree_peer(peer_addr),
            "Sent FilterAnnounce"
        );
        self.bloom_state.record_update_sent(*peer_addr, now_ms);
        self.bloom_state.record_sent_filter(*peer_addr, sent_filter);
        if let Some(peer) = self.peers.get_mut(peer_addr) {
            peer.clear_filter_update_needed();
        }

        Ok(())
    }

    /// Send pending rate-limited filter announces whose debounce has expired.
    pub(super) async fn send_pending_filter_announces(&mut self) {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let ready: Vec<NodeAddr> = self
            .peers
            .keys()
            .filter(|addr| self.bloom_state.should_send_update(addr, now_ms))
            .copied()
            .collect();

        if ready.is_empty() {
            return;
        }

        // One snapshot and one union pass for the whole ready set. The
        // send path never mutates peer inbound filters or the tree state,
        // and the rx loop holds `&mut self` across the awaits, so the
        // snapshot cannot go stale mid-loop.
        let peer_filters = self.peer_inbound_filters();
        let mut outgoing = self
            .bloom_state
            .compute_outgoing_filters(&ready, &peer_filters);

        for peer_addr in ready {
            let Some(filter) = outgoing.remove(&peer_addr) else {
                continue;
            };
            if let Err(e) = self.send_filter_announce_to_peer(&peer_addr, filter).await {
                debug!(
                    peer = %self.peer_display_name(&peer_addr),
                    error = %e,
                    "Failed to send pending FilterAnnounce"
                );
            }
        }
    }

    /// Handle an inbound FilterAnnounce from an authenticated peer.
    ///
    /// 1. Decode and validate the message
    /// 2. Check sequence freshness (reject stale/replay)
    /// 3. Store the filter on the peer
    /// 4. Mark other peers for outgoing filter update
    pub(super) async fn handle_filter_announce(&mut self, from: &NodeAddr, payload: &[u8]) {
        self.metrics().bloom.received.inc();

        let announce = match FilterAnnounce::decode(payload) {
            Ok(a) => a,
            Err(e) => {
                self.metrics().bloom.record_reject(BloomReject::DecodeError);
                debug!(from = %self.peer_display_name(from), error = %e, "Malformed FilterAnnounce");
                return;
            }
        };

        // Validate
        if !announce.is_valid() {
            self.metrics().bloom.record_reject(BloomReject::Invalid);
            debug!(from = %self.peer_display_name(from), "FilterAnnounce filter/size_class mismatch");
            return;
        }
        if !announce.is_v1_compliant() {
            self.metrics().bloom.record_reject(BloomReject::NonV1);
            debug!(from = %self.peer_display_name(from), size_class = announce.size_class, "Non-v1 FilterAnnounce rejected");
            return;
        }

        // Check peer exists
        let current_seq = match self.peers.get(from) {
            Some(peer) => peer.filter_sequence(),
            None => {
                self.metrics().bloom.record_reject(BloomReject::UnknownPeer);
                debug!(from = %self.peer_display_name(from), "FilterAnnounce from unknown peer");
                return;
            }
        };

        // Reject stale/replay
        if announce.sequence <= current_seq {
            self.metrics().bloom.record_reject(BloomReject::Stale);
            debug!(
                from = %self.peer_display_name(from),
                received_seq = announce.sequence,
                current_seq = current_seq,
                "Stale FilterAnnounce rejected"
            );
            return;
        }

        // Antipoison FPR cap. Reject announces whose FPR exceeds
        // node.bloom.max_inbound_fpr. Silent on the wire (no NACK) —
        // the peer's prior accepted filter and filter_sequence stay
        // untouched so the peer is not permanently silenced and an
        // on-path attacker cannot weaponize a single corrupted frame
        // to wipe a victim's contribution to aggregation.
        let max_fpr = self.config().node.bloom.max_inbound_fpr;
        let fill = announce.filter.fill_ratio();
        let fpr = announce.filter.fpr();
        if fpr > max_fpr {
            self.metrics()
                .bloom
                .record_reject(BloomReject::FillExceeded);
            warn!(
                from = %self.peer_display_name(from),
                seq = announce.sequence,
                fill = format_args!("{:.3}", fill),
                fpr = format_args!("{:.4}", fpr),
                cap = format_args!("{:.4}", max_fpr),
                "FilterAnnounce above FPR cap — rejected"
            );
            return;
        }

        self.metrics().bloom.accepted.inc();

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        debug!(
            from = %self.peer_display_name(from),
            seq = announce.sequence,
            est_entries = match announce.filter.estimated_count(max_fpr) {
                Some(n) => format!("{:.0}", n),
                None => "—".to_string(),
            },
            set_bits = announce.filter.count_ones(),
            fill = format_args!("{:.1}%", announce.filter.fill_ratio() * 100.0),
            tree_peer = self.is_tree_peer(from),
            "Received FilterAnnounce"
        );

        // Store on peer
        if let Some(peer) = self.peers.get_mut(from) {
            peer.update_filter(announce.filter, announce.sequence, now_ms);
        }

        // Check which peers' outgoing filters actually changed.
        // All peers receive filters, but only tree peers' inbound filters
        // are merged into outgoing computation (tree-only propagation).
        let peer_addrs: Vec<NodeAddr> = self.peers.keys().copied().collect();
        let peer_filters = self.peer_inbound_filters();
        self.bloom_state
            .mark_changed_peers(from, &peer_addrs, &peer_filters);
    }

    /// Read what `peer_addr`'s link shows about delivery of our frames: the
    /// session's identity and next send counter, and the last ReceiverReport
    /// accepted on it. `None` when the peer has no session. Both the filter
    /// and the tree announce resends read it.
    pub(super) fn link_evidence(&self, peer_addr: &NodeAddr) -> Option<LinkEvidence> {
        let peer = self.peers.get(peer_addr)?;
        let session = peer.noise_session()?;
        let mut epoch = [0u8; 8];
        epoch.copy_from_slice(&session.handshake_hash()[..8]);
        let rr = peer.mmp().and_then(|mmp| mmp.metrics.rr_counters()).map(
            |(highest, received, reordered)| RrCounters {
                highest,
                received,
                reordered,
            },
        );
        Some(LinkEvidence {
            epoch: u64::from_le_bytes(epoch),
            next_counter: session.current_send_counter(),
            rr,
        })
    }

    /// Mark for resend every peer whose outstanding announce the receiver
    /// reports show was lost, or could not confirm in time.
    fn check_announces(&mut self) {
        let now_ms = crate::time::mono_ms();
        let waiting: Vec<NodeAddr> = self
            .peers
            .keys()
            .filter(|addr| self.bloom_state.announce_outstanding(addr))
            .copied()
            .collect();
        for addr in waiting {
            let Some(link) = self.link_evidence(&addr) else {
                continue;
            };
            let counter = self.bloom_state.outstanding_counter(&addr);
            if let Some(reason) = self.bloom_state.check_announce(&addr, &link, now_ms) {
                debug!(
                    peer = %self.peer_display_name(&addr),
                    reason = ?reason,
                    counter = ?counter,
                    "Resending unconfirmed FilterAnnounce"
                );
            }
        }
    }

    /// Check bloom filter state on tick (called from event loop).
    ///
    /// Marks peers whose last announce was not confirmed delivered, then sends
    /// any pending debounced filter announces, so a resend goes out in the
    /// same tick through the ordinary send path.
    pub(super) async fn check_bloom_state(&mut self) {
        self.check_announces();
        self.send_pending_filter_announces().await;
    }
}
