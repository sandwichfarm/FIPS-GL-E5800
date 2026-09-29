//! Link-dead heartbeat rekey-awareness integration tests.
//!
//! `check_link_heartbeats()` reaps a peer after the link-dead timeout,
//! but suppresses teardown while an FMP rekey is genuinely in flight with
//! its msg1 retransmission budget unexhausted. These tests drive a real
//! two-node UDP peering, inject rekey state on the peer, and verify the
//! suppress / resume / regression behaviors. `link_dead_timeout_secs` is
//! set to 0 so the elapsed-time predicate is always satisfied and the only
//! variable is the rekey-active guard.

use super::spanning_tree::*;
use super::*;
use crate::Identity;
use crate::noise::HandshakeState;
use crate::utils::index::SessionIndex;

/// Arm a real (initiator) FMP rekey on the peer the given node holds for
/// `peer_addr`, so the msg1 resend budget can be exercised.
fn arm_rekey(node: &mut crate::node::Node, peer_addr: &NodeAddr) {
    let remote = Identity::generate();
    let local = Identity::generate();
    let hs = HandshakeState::new_initiator(local.keypair(), remote.pubkey_full());
    let peer = node.get_peer_mut(peer_addr).expect("peer present");
    peer.set_rekey_state(hs, SessionIndex::new(7), vec![0xAB; 64], 0);
}

/// Set `link_dead_timeout_secs` on an already-constructed node via the
/// sole-store copy-on-write context swap (immutable state is no longer a
/// directly-pokeable field; `config()` is a read-only accessor).
fn set_link_dead_timeout(node: &mut crate::node::Node, secs: u64) {
    node.replace_context(|ctx| {
        let mut cfg = (*ctx.config).clone();
        cfg.node.link_dead_timeout_secs = secs;
        ctx.config = std::sync::Arc::new(cfg);
    });
}

/// Set `heartbeat_interval_secs` on an already-constructed node, the same way
/// `set_link_dead_timeout` does.
pub(super) fn set_heartbeat_interval(node: &mut crate::node::Node, secs: u64) {
    node.replace_context(|ctx| {
        let mut cfg = (*ctx.config).clone();
        cfg.node.heartbeat_interval_secs = secs;
        ctx.config = std::sync::Arc::new(cfg);
    });
}

/// A heartbeat whose send failed is not recorded as having landed, and the
/// failed attempt is not retried on the very next tick.
///
/// The failure is forced by taking the node's transport handles away, so the
/// encrypted send fails before any I/O with `TransportNotFound`. Marking the
/// send before it happens, which is what this replaced, would record the peer
/// as heartbeated and suppress the next attempt for a whole interval although
/// the peer heard nothing.
#[tokio::test]
async fn a_failed_heartbeat_send_is_not_recorded_as_landed() {
    let mut nodes = run_tree_test(2, &[(0, 1)], false).await;
    verify_tree_convergence(&nodes);

    let addr_1 = *nodes[1].node.node_addr();
    assert!(nodes[0].node.get_peer(&addr_1).is_some());

    // Whatever landed during convergence is the baseline this asserts against.
    let landed_before = nodes[0]
        .node
        .get_peer(&addr_1)
        .unwrap()
        .last_heartbeat_sent();

    // Due on every tick, so the only variable is what the send does.
    set_heartbeat_interval(&mut nodes[0].node, 0);
    nodes[0].node.transports.clear();

    nodes[0].node.check_link_heartbeats().await;

    let peer = nodes[0].node.get_peer(&addr_1).expect("peer present");
    let failed_at = peer
        .last_heartbeat_attempt()
        .expect("the attempt is recorded even though the send failed");
    assert_eq!(
        peer.last_heartbeat_sent(),
        landed_before,
        "a heartbeat whose send failed was recorded as having landed"
    );

    // The retry gate spaces the next attempt out rather than letting a failing
    // peer be retried on every tick.
    nodes[0].node.check_link_heartbeats().await;

    let peer = nodes[0].node.get_peer(&addr_1).expect("peer present");
    assert_eq!(
        peer.last_heartbeat_attempt(),
        Some(failed_at),
        "a peer whose send failed was retried inside the retry interval"
    );

    cleanup_nodes(&mut nodes).await;
}

/// A peer past the link-dead timeout is NOT reaped while an FMP rekey is in
/// progress with its msg1 budget unexhausted.
#[tokio::test]
async fn heartbeat_suppressed_during_rekey() {
    let mut nodes = run_tree_test(2, &[(0, 1)], false).await;
    verify_tree_convergence(&nodes);

    let addr_1 = *nodes[1].node.node_addr();
    assert!(nodes[0].node.get_peer(&addr_1).is_some());

    // Force every link to read as dead on elapsed time alone.
    set_link_dead_timeout(&mut nodes[0].node, 0);

    // Arm a rekey with budget left (count 0 < max_resends default 5).
    arm_rekey(&mut nodes[0].node, &addr_1);
    assert!(nodes[0].node.get_peer(&addr_1).unwrap().rekey_in_progress());

    nodes[0].node.check_link_heartbeats().await;

    assert!(
        nodes[0].node.get_peer(&addr_1).is_some(),
        "peer reaped despite an in-flight rekey with budget remaining"
    );

    cleanup_nodes(&mut nodes).await;
}

/// Once the msg1 budget is exhausted the rekey-active guard no longer
/// holds, so a peer past the link-dead timeout IS reaped.
#[tokio::test]
async fn heartbeat_resumes_after_budget_exhausted() {
    let mut nodes = run_tree_test(2, &[(0, 1)], false).await;
    verify_tree_convergence(&nodes);

    let addr_1 = *nodes[1].node.node_addr();
    assert!(nodes[0].node.get_peer(&addr_1).is_some());

    set_link_dead_timeout(&mut nodes[0].node, 0);
    let max_resends = nodes[0].node.config().node.rate_limit.handshake_max_resends;

    arm_rekey(&mut nodes[0].node, &addr_1);

    // Exhaust the budget: count reaches max_resends, guard goes false.
    let peer = nodes[0].node.get_peer_mut(&addr_1).unwrap();
    for i in 0..max_resends {
        peer.record_rekey_msg1_resend(1000 + i as u64 * 100);
    }
    assert_eq!(
        nodes[0]
            .node
            .get_peer(&addr_1)
            .unwrap()
            .rekey_msg1_resend_count(),
        max_resends
    );

    nodes[0].node.check_link_heartbeats().await;

    assert!(
        nodes[0].node.get_peer(&addr_1).is_none(),
        "peer not reaped after its rekey budget was exhausted"
    );

    cleanup_nodes(&mut nodes).await;
}

/// Regression guard: with no rekey in flight, a peer past the link-dead
/// timeout is reaped exactly as before.
#[tokio::test]
async fn heartbeat_unaffected_without_rekey() {
    let mut nodes = run_tree_test(2, &[(0, 1)], false).await;
    verify_tree_convergence(&nodes);

    let addr_1 = *nodes[1].node.node_addr();
    assert!(nodes[0].node.get_peer(&addr_1).is_some());
    assert!(!nodes[0].node.get_peer(&addr_1).unwrap().rekey_in_progress());

    set_link_dead_timeout(&mut nodes[0].node, 0);

    nodes[0].node.check_link_heartbeats().await;

    assert!(
        nodes[0].node.get_peer(&addr_1).is_none(),
        "dead peer with no rekey in flight should be reaped"
    );

    cleanup_nodes(&mut nodes).await;
}
