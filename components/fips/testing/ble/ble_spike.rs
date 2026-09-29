//! BLE L2CAP spike — validates bluer API assumptions for the BleIo trait.
//!
//! Usage:
//!   ble_spike listen              # Advertise + listen for L2CAP connections
//!   ble_spike connect <MAC>       # Scan + connect to a listening peer
//!   ble_spike info                # Print adapter info only
//!
//! Build: cd testing/ble && cargo build
//!
//! Test flow (two machines with BLE adapters):
//!   host-a$ ./ble_spike listen
//!   host-b$ ./ble_spike connect <host-a-MAC>

mod spike {
    use bluer::l2cap::{SeqPacket, SeqPacketListener, Socket, SocketAddr};
    use bluer::{adv::Advertisement, AdapterEvent, Address, AddressType, DiscoveryFilter, DiscoveryTransport};
    use futures::StreamExt;
    use std::collections::BTreeSet;
    use std::pin::pin;
    use tokio::time::{timeout, Duration};

    /// FIPS BLE service UUID.
    /// Derived from SHA-256("FIPS: welcome to cryptoanarchy") with UUID v4
    /// version/variant bits applied.
    const FIPS_SERVICE_UUID: bluer::Uuid = bluer::Uuid::from_u128(
        0x9c90_b790_2cc5_42c0_9f87_c9cc_4064_8f4c,
    );

    /// L2CAP PSM for FIPS connections (dynamic range).
    const FIPS_PSM: u16 = 0x0085;

    /// Desired L2CAP CoC MTU (requested during negotiation).
    /// Override with FIPS_BLE_MTU env var for testing asymmetric MTU.
    fn desired_mtu() -> u16 {
        std::env::var("FIPS_BLE_MTU")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(2048)
    }

    /// Test message sent over L2CAP.
    const TEST_MSG: &[u8] = b"FIPS BLE spike test";

    pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
        let args: Vec<String> = std::env::args().collect();
        let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("info");

        let session = bluer::Session::new().await?;
        let adapter = session.default_adapter().await?;
        adapter.set_powered(true).await?;

        let addr = adapter.address().await?;
        let name = adapter.name().to_string();
        println!("Adapter: {} ({})", name, addr);
        println!("Address type: {:?}", adapter.address_type().await?);

        match cmd {
            "info" => {
                println!("Adapter info only. Use 'listen' or 'connect <MAC>' for testing.");
            }
            "listen" => listen(&adapter).await?,
            "connect" => {
                let mac = args.get(2).ok_or("usage: ble_spike connect <MAC>")?;
                let target: Address = mac.parse().map_err(|_| format!("invalid MAC: {mac}"))?;
                connect(&adapter, target).await?;
            }
            "sink" => sink(&adapter).await?,
            "throughput" => {
                let mac = args.get(2).ok_or("usage: ble_spike throughput <MAC>")?;
                let target: Address = mac.parse().map_err(|_| format!("invalid MAC: {mac}"))?;
                throughput(&adapter, target).await?;
            }
            other => {
                eprintln!("unknown command: {other}");
                eprintln!("usage: ble_spike [info|listen|connect|sink|throughput] <MAC>");
                std::process::exit(1);
            }
        }

        Ok(())
    }

    async fn listen(adapter: &bluer::Adapter) -> Result<(), Box<dyn std::error::Error>> {
        // Start advertising the FIPS UUID
        let adv = Advertisement {
            advertisement_type: bluer::adv::Type::Peripheral,
            service_uuids: {
                let mut s = BTreeSet::new();
                s.insert(FIPS_SERVICE_UUID);
                s
            },
            local_name: Some("fips-spike".to_string()),
            ..Default::default()
        };
        let adv_handle = adapter.advertise(adv).await?;
        println!("Advertising FIPS UUID: {FIPS_SERVICE_UUID}");

        // Bind L2CAP SeqPacket listener with requested MTU
        let local_sa = SocketAddr::new(
            adapter.address().await?,
            AddressType::LePublic,
            FIPS_PSM,
        );
        let listener = SeqPacketListener::bind(local_sa).await?;
        listener.as_ref().set_recv_mtu(desired_mtu())?;
        let mtu = desired_mtu();
        println!("Listening on PSM 0x{FIPS_PSM:04X} (requested MTU: {mtu})");
        println!("Waiting for connection... (Ctrl-C to stop)");

        // Accept one connection
        let (conn, peer_sa) = listener.accept().await?;
        println!("Accepted connection from: {}", peer_sa.addr);
        println!("  Send MTU: {}", conn.send_mtu()?);
        println!("  Recv MTU: {}", conn.recv_mtu()?);

        // Receive data
        let mut buf = vec![0u8; 4096];
        let n = conn.recv(&mut buf).await?;
        println!("  Received {} bytes: {:?}", n, String::from_utf8_lossy(&buf[..n]));

        // Send response
        let response = b"FIPS BLE spike response";
        let sent = conn.send(response).await?;
        println!("  Sent {} bytes", sent);

        // Receive and echo large payload
        let n = timeout(Duration::from_secs(5), conn.recv(&mut buf)).await??;
        println!("  Received large payload: {} bytes", n);
        let echoed = conn.send(&buf[..n]).await?;
        println!("  Echoed {} bytes", echoed);

        // Wait a moment before cleanup
        tokio::time::sleep(Duration::from_secs(2)).await;
        drop(adv_handle);
        println!("Done.");
        Ok(())
    }

    async fn connect(
        adapter: &bluer::Adapter,
        target: Address,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Optional: scan for the target first to verify it's advertising
        println!("Scanning for target {target}...");
        let filter = DiscoveryFilter {
            transport: DiscoveryTransport::Le,
            ..Default::default()
        };
        adapter.set_discovery_filter(filter).await?;

        let events = adapter.discover_devices().await?;
        let mut events = pin!(events);

        let found = timeout(Duration::from_secs(10), async {
            while let Some(event) = events.next().await {
                if let AdapterEvent::DeviceAdded(addr) = event {
                    println!("  Discovered: {addr}");
                    if addr == target {
                        // Check if it has our UUID
                        if let Ok(device) = adapter.device(addr) {
                            if let Ok(Some(uuids)) = device.uuids().await {
                                if uuids.contains(&FIPS_SERVICE_UUID) {
                                    println!("  -> Found FIPS service UUID!");
                                    return true;
                                }
                            }
                        }
                        println!("  -> Target found (no UUID filter match, connecting anyway)");
                        return true;
                    }
                }
            }
            false
        })
        .await;

        match found {
            Ok(true) => println!("Target found."),
            Ok(false) => println!("Scan ended without finding target, trying connect anyway..."),
            Err(_) => println!("Scan timeout, trying connect anyway..."),
        }

        // Stop scanning before connecting
        drop(events);

        // Connect via L2CAP SeqPacket with requested MTU
        let target_sa = SocketAddr::new(target, AddressType::LePublic, FIPS_PSM);
        let mtu = desired_mtu();
        println!("Connecting to {target} on PSM 0x{FIPS_PSM:04X} (requested MTU: {mtu})...");

        let socket = Socket::<SeqPacket>::new_seq_packet()?;
        socket.bind(SocketAddr::any_le())?;
        socket.set_recv_mtu(desired_mtu())?;
        let conn = timeout(Duration::from_secs(15), socket.connect(target_sa)).await??;
        println!("Connected!");
        println!("  Send MTU: {}", conn.send_mtu()?);
        println!("  Recv MTU: {}", conn.recv_mtu()?);
        println!("  Peer: {}", conn.peer_addr()?.addr);

        // Send small test message
        let sent = conn.send(TEST_MSG).await?;
        println!("  Sent {} bytes: {:?}", sent, String::from_utf8_lossy(TEST_MSG));

        // Receive response
        let mut buf = vec![0u8; 4096];
        let n = timeout(Duration::from_secs(5), conn.recv(&mut buf)).await??;
        println!("  Received {} bytes: {:?}", n, String::from_utf8_lossy(&buf[..n]));

        // Send large payload to test MTU
        let send_mtu = conn.send_mtu()?;
        let large = vec![0xAB_u8; send_mtu];
        let sent = conn.send(&large).await?;
        println!("  Sent large payload: {} bytes (send_mtu={})", sent, send_mtu);

        let n = timeout(Duration::from_secs(5), conn.recv(&mut buf)).await??;
        println!("  Received large echo: {} bytes", n);

        println!("Done.");
        Ok(())
    }

    /// Sink mode: advertise, accept connection, receive and count bytes for 10s.
    async fn sink(adapter: &bluer::Adapter) -> Result<(), Box<dyn std::error::Error>> {
        let adv = Advertisement {
            advertisement_type: bluer::adv::Type::Peripheral,
            service_uuids: {
                let mut s = BTreeSet::new();
                s.insert(FIPS_SERVICE_UUID);
                s
            },
            local_name: Some("fips-sink".to_string()),
            ..Default::default()
        };
        let _adv_handle = adapter.advertise(adv).await?;

        let local_sa = SocketAddr::new(
            adapter.address().await?,
            AddressType::LePublic,
            FIPS_PSM,
        );
        let listener = SeqPacketListener::bind(local_sa).await?;
        listener.as_ref().set_recv_mtu(desired_mtu())?;
        println!("Sink waiting for connection...");

        let (conn, peer_sa) = listener.accept().await?;
        println!(
            "Connected from {} (send_mtu={}, recv_mtu={})",
            peer_sa.addr,
            conn.send_mtu()?,
            conn.recv_mtu()?,
        );

        let mut buf = vec![0u8; 8192];
        let mut total_bytes: u64 = 0;
        let mut total_msgs: u64 = 0;
        let start = std::time::Instant::now();

        loop {
            match conn.recv(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    total_bytes += n as u64;
                    total_msgs += 1;
                }
                Err(_) => break,
            }
        }

        let elapsed = start.elapsed();
        let secs = elapsed.as_secs_f64();
        let kbps = (total_bytes as f64 * 8.0) / (secs * 1000.0);
        println!(
            "Received {} bytes in {} messages over {:.2}s ({:.1} kbps)",
            total_bytes, total_msgs, secs, kbps,
        );
        Ok(())
    }

    /// Throughput mode: connect and blast data for 10 seconds.
    async fn throughput(
        adapter: &bluer::Adapter,
        target: Address,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Scan for target
        println!("Scanning for {target}...");
        let filter = DiscoveryFilter {
            transport: DiscoveryTransport::Le,
            ..Default::default()
        };
        adapter.set_discovery_filter(filter).await?;
        let events = adapter.discover_devices().await?;
        let mut events = pin!(events);

        let _ = timeout(Duration::from_secs(10), async {
            while let Some(event) = events.next().await {
                if let AdapterEvent::DeviceAdded(addr) = event {
                    if addr == target {
                        return;
                    }
                }
            }
        })
        .await;
        drop(events);

        // Connect with MTU
        let target_sa = SocketAddr::new(target, AddressType::LePublic, FIPS_PSM);
        let socket = Socket::<SeqPacket>::new_seq_packet()?;
        socket.bind(SocketAddr::any_le())?;
        socket.set_recv_mtu(desired_mtu())?;
        let conn = timeout(Duration::from_secs(15), socket.connect(target_sa)).await??;

        let send_mtu = conn.send_mtu()?;
        println!(
            "Connected (send_mtu={}, recv_mtu={}). Sending for 10s...",
            send_mtu,
            conn.recv_mtu()?,
        );

        let payload = vec![0xAB_u8; send_mtu];
        let mut total_bytes: u64 = 0;
        let mut total_msgs: u64 = 0;
        let mut errors: u64 = 0;
        let start = std::time::Instant::now();
        let duration = Duration::from_secs(10);

        while start.elapsed() < duration {
            match conn.send(&payload).await {
                Ok(n) => {
                    total_bytes += n as u64;
                    total_msgs += 1;
                }
                Err(_) => {
                    errors += 1;
                    if errors > 10 {
                        println!("Too many errors, stopping.");
                        break;
                    }
                }
            }
        }

        let elapsed = start.elapsed();
        let secs = elapsed.as_secs_f64();
        let kbps = (total_bytes as f64 * 8.0) / (secs * 1000.0);
        println!(
            "Sent {} bytes in {} messages over {:.2}s ({:.1} kbps, {} errors)",
            total_bytes, total_msgs, secs, kbps, errors,
        );

        // Close cleanly
        let _ = conn.shutdown(std::net::Shutdown::Both);
        Ok(())
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(e) = spike::run().await {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}
