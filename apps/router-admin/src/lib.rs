//! Shared, bounded management contract for the web and touchscreen clients.
//! It never reads private identity files or returns unrestricted daemon data.
pub mod route_advertisement;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

pub const MAX_REQUEST: usize = 32_768;
const MAX_RESPONSE: u64 = 262_144;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Peer {
    pub npub: String,
    pub transport: Transport,
    pub address: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Udp,
    Tcp,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub enabled: bool,
    pub udp_port: u16,
    pub tcp_port: u16,
    pub gateway_enabled: bool,
    pub peers: Vec<Peer>,
    pub mesh_tcp_ports: Vec<u16>,
    pub mesh_udp_ports: Vec<u16>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HealthProbes {
    ip: String,
    name: String,
    minimum_links: u16,
    components: String,
    #[serde(default)]
    ipv6: Option<String>,
}

impl HealthProbes {
    fn valid(&self) -> bool {
        let components: Vec<&str> = self.components.split(',').collect();
        let mut canonical = components.clone();
        canonical.sort_unstable();
        canonical.dedup();
        self.ip.parse::<Ipv4Addr>().is_ok()
            && !self.name.is_empty()
            && self.name.len() <= 253
            && self
                .name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'.')
            && self.minimum_links > 0
            && components == canonical
            && components
                .iter()
                .all(|name| matches!(*name, "fips" | "web_ui" | "device_ui"))
            && self.ipv6.as_ref().is_none_or(|ip| {
                ip.parse::<Ipv6Addr>().is_ok_and(|address| {
                    let segments = address.segments();
                    // Public unicast only; reject documentation and the
                    // local benchmarking prefix used by the LAN gateway.
                    segments[0] & 0xe000 == 0x2000
                        && !(segments[0] == 0x2001 && matches!(segments[1], 0x0db8 | 0x0002))
                })
            })
    }

    fn valid_for(&self, settings: &Settings) -> bool {
        self.valid() && (!settings.gateway_enabled || self.ipv6.is_some())
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            udp_port: 2121,
            tcp_port: 8443,
            gateway_enabled: false,
            peers: vec![],
            mesh_tcp_ports: vec![],
            mesh_udp_ports: vec![],
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), &'static str> {
        // Reserve local management, DNS and multicast discovery ports.
        for port in [self.udp_port, self.tcp_port] {
            if port < 1024 || [5353, 5354, 5365].contains(&port) {
                return Err("transport_port_reserved");
            }
        }
        if self.peers.len() > 64 {
            return Err("too_many_peers");
        }
        let mut peers = HashSet::new();
        for peer in &self.peers {
            fips::PeerIdentity::from_npub(&peer.npub).map_err(|_| "invalid_peer_identity")?;
            if !peers.insert(&peer.npub) {
                return Err("duplicate_peer");
            }
            if !valid_endpoint(&peer.address) {
                return Err("invalid_peer_address");
            }
        }
        for ports in [&self.mesh_tcp_ports, &self.mesh_udp_ports] {
            if ports.len() > 32 || ports.contains(&0) {
                return Err("invalid_mesh_ports");
            }
            if ports.iter().copied().collect::<HashSet<_>>().len() != ports.len() {
                return Err("duplicate_mesh_port");
            }
        }
        if self.gateway_enabled && !self.enabled {
            return Err("gateway_requires_node");
        }
        let document = self.daemon_config();
        let parsed: fips::Config =
            serde_json::from_value(document).map_err(|_| "invalid_daemon_config")?;
        parsed.validate().map_err(|_| "invalid_daemon_config")?;
        Ok(())
    }

    /// Generated JSON is also valid YAML; there is no string interpolation into YAML.
    /// Identity resolution remains upstream's responsibility and always persists.
    pub fn daemon_config(&self) -> Value {
        json!({
            "node": {"identity": {"persistent": true},
                     "control": {"socket_path": "/run/fips/control.sock"}, "log_level": "info"},
            "tun": {"enabled": true, "name": "fips0", "mtu": 1280},
            "dns": {"enabled": true, "bind_addr": "::1", "port": 5354},
            "transports": {
                "udp": {"bind_addr": format!("[::]:{}", self.udp_port)},
                "tcp": {"bind_addr": format!("[::]:{}", self.tcp_port)}
            },
            "gateway": {"enabled": self.gateway_enabled, "pool": "fd01::/112",
                        "lan_interface": "br-lan",
                        "dns": {"listen": "[::1]:5365", "upstream": "[::1]:5354", "ttl": 60}},
            "peers": self.peers.iter().map(|peer| json!({
                "npub": peer.npub,
                "addresses": [{"transport": peer.transport, "addr": peer.address}],
                "connect_policy": "auto_connect"
            })).collect::<Vec<_>>()
        })
    }

    /// Dedicated ingress policy for traffic arriving from mesh peers.
    /// OpenWrt fw4 integration and activation are separate transaction steps.
    pub fn mesh_firewall(&self) -> String {
        let mut rules = String::from(
            "table inet fips {\n chain inbound {\n  type filter hook input priority -5; policy accept;\n  iifname != \"fips0\" return\n  ct state established,related accept\n  icmpv6 type { echo-request, destination-unreachable, packet-too-big, time-exceeded } accept\n",
        );
        for port in &self.mesh_tcp_ports {
            rules.push_str(&format!("  tcp dport {port} accept\n"));
        }
        for port in &self.mesh_udp_ports {
            rules.push_str(&format!("  udp dport {port} accept\n"));
        }
        rules.push_str("  counter drop\n }\n}\n");
        rules
    }
}

fn valid_endpoint(value: &str) -> bool {
    if let Ok(address) = value.parse::<SocketAddr>() {
        return address.port() > 0
            && !address.ip().is_unspecified()
            && !address.ip().is_multicast();
    }
    let Some((host, port)) = value.rsplit_once(':') else {
        return false;
    };
    if host.len() > 253 || port.parse::<u16>().ok().filter(|p| *p > 0).is_none() {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Status,
    Peers,
    Diagnostics,
    Configuration,
    Validate {
        settings: Settings,
    },
    Stage {
        settings: Settings,
        expected_revision: String,
    },
    Activate {
        expected_revision: String,
    },
    ActivatePackage {
        expected_revision: String,
        transaction_id: String,
    },
    Confirm {
        transaction_id: String,
    },
    Rollback {
        transaction_id: String,
    },
    Recovery,
}

pub struct Backend {
    pub state_dir: PathBuf,
    pub socket_path: PathBuf,
    pub system_root: PathBuf,
    pub package_activation_allowed: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Candidate {
    revision: String,
    base_revision: String,
    daemon: Value,
    firewall: String,
    settings: Settings,
}

impl Backend {
    pub fn handle(&self, request: &[u8]) -> Value {
        if request.len() > MAX_REQUEST {
            return json!({"status": "error", "error": "request_too_large"});
        }
        let parsed = parse_request(request);
        match parsed.and_then(|request| self.execute(request)) {
            Ok(data) => json!({"status": "ok", "data": data}),
            Err(error) => json!({"status": "error", "error": error}),
        }
    }

    fn execute(&self, request: Request) -> Result<Value, &'static str> {
        match request {
            Request::Configuration => {
                let settings = self.load()?;
                Ok(json!({"revision": revision(&settings), "settings": settings}))
            }
            Request::Validate { settings } => {
                settings.validate()?;
                Ok(json!({"valid": true}))
            }
            Request::Stage {
                settings,
                expected_revision,
            } => {
                settings.validate()?;
                let _lock = self.lock()?;
                if revision(&self.load()?) != expected_revision {
                    return Err("revision_conflict");
                }
                // A single atomic candidate carries both human settings and generated
                // daemon configuration. Activation belongs to the rollback transaction.
                let candidate = json!({"revision": revision(&settings),
                    "base_revision": expected_revision,
                    "daemon": settings.daemon_config(),
                    "firewall": settings.mesh_firewall(), "settings": settings});
                atomic_json(&self.state_dir.join("candidate.json"), &candidate)?;
                Ok(json!({"staged": true, "revision": candidate["revision"], "activated": false}))
            }
            Request::Activate { expected_revision } => self.activate(&expected_revision),
            Request::ActivatePackage {
                expected_revision,
                transaction_id,
            } => self.activate_package(&expected_revision, &transaction_id),
            Request::Confirm { transaction_id } => self.confirm(&transaction_id),
            Request::Rollback { transaction_id } => self.rollback(&transaction_id),
            Request::Recovery => self.recovery(),
            Request::Status => match query(&self.socket_path, "show_status") {
                Ok(data) => {
                    let mut status = project(
                        &data,
                        &[
                            "version",
                            "npub",
                            "ipv6_addr",
                            "node_addr",
                            "state",
                            "persistent",
                            "peer_count",
                            "link_count",
                            "uptime_secs",
                            "tun_state",
                        ],
                    );
                    status["persistent"] =
                        json!(data["persistent"] == true && self.persistent_key_ok());
                    Ok(status)
                }
                Err(error) => Ok(json!({"state": "offline", "reason": error})),
            },
            Request::Peers => {
                let data = query(&self.socket_path, "show_peers")?;
                let peers = data["peers"].as_array().ok_or("invalid_daemon_response")?;
                Ok(
                    json!({"peers": peers.iter().take(256).map(|peer| project(peer,
                    &["npub", "ipv6_addr", "display_name", "connectivity", "transport_type", "transport_addr"])).collect::<Vec<_>>() }),
                )
            }
            Request::Diagnostics => {
                let data = query(&self.socket_path, "show_status")?;
                let mut node = project(
                    &data,
                    &[
                        "state",
                        "persistent",
                        "tun_state",
                        "transport_count",
                        "peer_count",
                    ],
                );
                node["persistent"] = json!(data["persistent"] == true && self.persistent_key_ok());
                Ok(json!({"daemon_reachable": true, "node": node,
                    "configuration_valid": self.load().and_then(|s| s.validate()).is_ok()}))
            }
        }
    }

    fn system_path(&self, path: &str) -> PathBuf {
        self.system_root.join(path.trim_start_matches('/'))
    }

    fn persistent_key_ok(&self) -> bool {
        let Some(parent) = self.state_dir.parent() else {
            return false;
        };
        let Ok(metadata) = fs::symlink_metadata(parent.join("fips.key")) else {
            return false;
        };
        metadata.is_file()
            && metadata.len() > 0
            && metadata.uid() == unsafe { libc::geteuid() }
            && metadata.permissions().mode() & 0o077 == 0
    }

    fn guard(&self, args: &[&str]) -> Result<String, &'static str> {
        let guard = self.system_path("/etc/fips-recovery/guard.sh");
        let output = Command::new("/bin/sh")
            .arg(guard)
            .args(args)
            .output()
            .map_err(|_| "recovery_guard_unavailable")?;
        if !output.status.success() {
            return Err("recovery_guard_unavailable");
        }
        String::from_utf8(output.stdout).map_err(|_| "recovery_guard_unavailable")
    }

    fn run(&self, path: &str, args: &[&str]) -> Result<(), &'static str> {
        let result = Command::new(self.system_path(path))
            .args(args)
            .status()
            .map_err(|_| "activation_failed")?;
        if result.success() {
            Ok(())
        } else {
            Err("activation_failed")
        }
    }

    fn fw4_zone(&self, settings: &Settings) -> Result<(), &'static str> {
        let uci = self.system_path("/sbin/uci");
        let owned = [
            (
                "fips_mesh",
                "zone",
                &[("name", "fips_mesh"), ("device", "fips0")][..],
            ),
            (
                "fips_lan",
                "forwarding",
                &[("src", "lan"), ("dest", "fips_mesh")][..],
            ),
            (
                "fips_tcp",
                "rule",
                &[("name", "FIPS-TCP"), ("src", "fips_mesh")][..],
            ),
            (
                "fips_udp",
                "rule",
                &[("name", "FIPS-UDP"), ("src", "fips_mesh")][..],
            ),
            (
                "fips_icmp",
                "rule",
                &[("name", "FIPS-ICMPv6"), ("src", "fips_mesh")][..],
            ),
        ];
        let mut existing = Vec::new();
        for (name, kind, options) in owned {
            let section = Command::new(&uci)
                .args(["-q", "get", &format!("firewall.{name}")])
                .output()
                .map_err(|_| "activation_failed")?;
            let present = section.status.success();
            if present {
                if section.stdout != format!("{kind}\n").as_bytes() {
                    return Err("firewall_zone_conflict");
                }
                for (option, expected) in options {
                    let result = Command::new(&uci)
                        .args(["-q", "get", &format!("firewall.{name}.{option}")])
                        .output()
                        .map_err(|_| "activation_failed")?;
                    if !result.status.success()
                        || result.stdout != format!("{expected}\n").as_bytes()
                    {
                        return Err("firewall_zone_conflict");
                    }
                }
            }
            existing.push((name, present));
        }
        if !settings.enabled && existing.iter().all(|(_, present)| !present) {
            return Ok(());
        }
        let mut edits: Vec<String> = Vec::new();
        // Recreate owned sections so stale options cannot silently widen the policy.
        for (name, present) in &existing {
            if *present {
                edits.push(format!("delete firewall.{name}"));
            }
        }
        if settings.enabled {
            edits.extend(
                [
                    "set firewall.fips_mesh=zone",
                    "set firewall.fips_mesh.name=fips_mesh",
                    "set firewall.fips_mesh.device=fips0",
                    "set firewall.fips_mesh.family=ipv6",
                    "set firewall.fips_mesh.input=REJECT",
                    "set firewall.fips_mesh.output=ACCEPT",
                    "set firewall.fips_mesh.forward=REJECT",
                    "set firewall.fips_mesh.masq=0",
                    "set firewall.fips_icmp=rule",
                    "set firewall.fips_icmp.name=FIPS-ICMPv6",
                    "set firewall.fips_icmp.src=fips_mesh",
                    "set firewall.fips_icmp.family=ipv6",
                    "set firewall.fips_icmp.proto=icmp",
                    "add_list firewall.fips_icmp.icmp_type=echo-request",
                    "add_list firewall.fips_icmp.icmp_type=destination-unreachable",
                    "add_list firewall.fips_icmp.icmp_type=packet-too-big",
                    "add_list firewall.fips_icmp.icmp_type=time-exceeded",
                    "set firewall.fips_icmp.target=ACCEPT",
                ]
                .into_iter()
                .map(str::to_owned),
            );
            for (name, proto, ports) in [
                ("fips_tcp", "tcp", &settings.mesh_tcp_ports),
                ("fips_udp", "udp", &settings.mesh_udp_ports),
            ] {
                if ports.is_empty() {
                    continue;
                }
                let label = if proto == "tcp" {
                    "FIPS-TCP"
                } else {
                    "FIPS-UDP"
                };
                edits.extend([
                    format!("set firewall.{name}=rule"),
                    format!("set firewall.{name}.name={label}"),
                    format!("set firewall.{name}.src=fips_mesh"),
                    format!("set firewall.{name}.family=ipv6"),
                    format!("set firewall.{name}.proto={proto}"),
                    format!(
                        "set firewall.{name}.dest_port={}",
                        ports
                            .iter()
                            .map(u16::to_string)
                            .collect::<Vec<_>>()
                            .join(" ")
                    ),
                    format!("set firewall.{name}.target=ACCEPT"),
                ]);
            }
        }
        if settings.gateway_enabled {
            edits.extend(
                [
                    "set firewall.fips_lan=forwarding",
                    "set firewall.fips_lan.src=lan",
                    "set firewall.fips_lan.dest=fips_mesh",
                    "set firewall.fips_lan.family=ipv6",
                ]
                .into_iter()
                .map(str::to_owned),
            );
        }
        for edit in edits {
            let (verb, value) = edit.split_once(' ').ok_or("activation_failed")?;
            let status = Command::new(&uci)
                .args([verb, value])
                .status()
                .map_err(|_| "activation_failed")?;
            if !status.success() {
                return Err("activation_failed");
            }
        }
        let status = Command::new(&uci)
            .args(["commit", "firewall"])
            .status()
            .map_err(|_| "activation_failed")?;
        if !status.success() {
            return Err("activation_failed");
        }
        self.run("/etc/init.d/firewall", &["restart"])
    }

    fn prepared_candidate(&self, expected_revision: &str) -> Result<Candidate, &'static str> {
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(self.state_dir.join("candidate.json"))
            .map_err(|_| "candidate_missing")?;
        let candidate: Candidate =
            serde_json::from_reader(file.take(131_073)).map_err(|_| "candidate_invalid")?;
        candidate.settings.validate()?;
        if candidate.revision != expected_revision
            || candidate.revision != revision(&candidate.settings)
            || candidate.base_revision != revision(&self.load()?)
        {
            return Err("revision_conflict");
        }
        if candidate.daemon != candidate.settings.daemon_config()
            || candidate.firewall != candidate.settings.mesh_firewall()
        {
            return Err("candidate_invalid");
        }
        Ok(candidate)
    }

    fn confirmation_probes(&self, settings: &Settings) -> Result<HealthProbes, &'static str> {
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(self.system_path("/etc/fips-recovery/probes.json"))
            .map_err(|_| "confirmation_probes_missing")?;
        let probes: HealthProbes =
            serde_json::from_reader(file.take(4097)).map_err(|_| "confirmation_probes_invalid")?;
        if !probes.valid_for(settings) {
            return Err("confirmation_probes_invalid");
        }
        Ok(probes)
    }

    fn activate(&self, expected_revision: &str) -> Result<Value, &'static str> {
        let _lock = self.lock()?;
        let candidate = self.prepared_candidate(expected_revision)?;
        if candidate.settings.gateway_enabled {
            self.confirmation_probes(&candidate.settings)?;
        }
        if self.guard(&["status"])?.trim() != "NONE" {
            return Err("deployment_pending");
        }
        let mut entropy = [0u8; 8];
        File::open("/dev/urandom")
            .and_then(|mut file| file.read_exact(&mut entropy))
            .map_err(|_| "state_unavailable")?;
        let transaction_id = format!("cfg_{}", hex_bytes(&entropy));
        let transaction_dir = self.system_path("/etc/fips-recovery").join(&transaction_id);
        fs::create_dir(&transaction_dir).map_err(|_| "state_unavailable")?;
        fs::set_permissions(&transaction_dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "state_unavailable")?;
        fs::create_dir(transaction_dir.join("previous")).map_err(|_| "state_unavailable")?;
        self.guard(&["arm", &transaction_id, "180", "config_only"])?;
        if self.apply_candidate(&candidate).is_err() {
            let _ = self.guard(&["rollback"]);
            return Err("activation_failed");
        }
        Ok(json!({"pending": true, "transaction_id": transaction_id,
                  "deadline_seconds": 180, "revision": candidate.revision}))
    }

    fn activate_package(
        &self,
        expected_revision: &str,
        transaction_id: &str,
    ) -> Result<Value, &'static str> {
        if !self.package_activation_allowed {
            return Err("operation_unavailable");
        }
        if !valid_package_transaction_id(transaction_id) {
            return Err("invalid_request");
        }
        let _lock = self.lock()?;
        let candidate = self.prepared_candidate(expected_revision)?;
        if candidate.settings.gateway_enabled {
            self.confirmation_probes(&candidate.settings)?;
        }
        let status = self.guard(&["status"])?;
        let mut words = status.split_whitespace();
        if words.next() != Some("PENDING") || words.next() != Some(transaction_id) {
            return Err("transaction_not_pending");
        }
        let mode = self
            .system_path("/etc/fips-recovery")
            .join(transaction_id)
            .join("backup/mode");
        if fs::read_to_string(mode)
            .map_err(|_| "transaction_not_pending")?
            .trim()
            != "packages"
        {
            return Err("transaction_not_pending");
        }
        if self.apply_candidate(&candidate).is_err() {
            let _ = self.guard(&["rollback"]);
            return Err("activation_failed");
        }
        Ok(json!({"pending": true, "transaction_id": transaction_id,
                  "revision": candidate.revision}))
    }

    fn apply_candidate(&self, candidate: &Candidate) -> Result<(), &'static str> {
        let fips_dir = self.system_path("/etc/fips");
        fs::create_dir_all(&fips_dir).map_err(|_| "activation_failed")?;
        fs::set_permissions(&fips_dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "activation_failed")?;
        atomic_json(
            &self.state_dir.join("settings.json"),
            &serde_json::to_value(&candidate.settings).map_err(|_| "activation_failed")?,
        )?;
        let mut daemon =
            serde_json::to_vec_pretty(&candidate.daemon).map_err(|_| "activation_failed")?;
        daemon.push(b'\n');
        atomic_bytes(&fips_dir.join("fips.yaml"), &daemon)?;
        atomic_bytes(
            &self.state_dir.join("mesh.nft"),
            candidate.firewall.as_bytes(),
        )?;
        let nft = self.system_path("/usr/sbin/nft");
        if !nft.is_file() {
            return Err("activation_failed");
        }
        let service = "/etc/init.d/fips";
        let gateway = "/etc/init.d/fips-gateway";
        // Remove the old LAN DNS/RA wiring before changing the daemon config.
        // The gateway init script restores only values it previously owned.
        self.run(gateway, &["stop"])?;
        self.run(gateway, &["disable"])?;
        self.run(service, &["stop"])?;
        let _ = Command::new(&nft)
            .args(["delete", "table", "inet", "fips"])
            .status();
        if candidate.settings.enabled {
            let rules = self.state_dir.join("mesh.nft");
            let status = Command::new(&nft)
                .arg("-f")
                .arg(rules)
                .status()
                .map_err(|_| "activation_failed")?;
            if !status.success() {
                return Err("activation_failed");
            }
            self.fw4_zone(&candidate.settings)?;
            self.run(service, &["enable"])?;
            self.run(service, &["restart"])?;
            if candidate.settings.gateway_enabled {
                self.run(gateway, &["enable"])?;
                self.run(gateway, &["start"])?;
            }
        } else {
            self.fw4_zone(&candidate.settings)?;
            self.run(service, &["disable"])?;
        }
        Ok(())
    }

    fn confirm(&self, transaction_id: &str) -> Result<Value, &'static str> {
        if !valid_transaction_id(transaction_id) {
            return Err("invalid_request");
        }
        let _lock = self.lock()?;
        let status = self.guard(&["status"])?;
        if status.split_whitespace().nth(1) != Some(transaction_id) {
            return Err("transaction_not_pending");
        }
        let mode = self
            .system_path("/etc/fips-recovery")
            .join(transaction_id)
            .join("backup/mode");
        if fs::read_to_string(mode)
            .map_err(|_| "transaction_not_pending")?
            .trim()
            != "config_only"
        {
            return Err("transaction_not_pending");
        }
        let settings = self.load()?;
        if settings.enabled {
            let daemon = query(&self.socket_path, "show_status")?;
            if daemon["persistent"] != true || !self.persistent_key_ok() {
                return Err("identity_not_persistent");
            }
        }
        if settings.gateway_enabled {
            self.run("/etc/init.d/fips-gateway", &["status"])
                .map_err(|_| "gateway_not_running")?;
            if !fs::metadata(self.system_path("/run/fips/gateway.sock"))
                .map(|metadata| metadata.file_type().is_socket())
                .unwrap_or(false)
            {
                return Err("gateway_not_running");
            }
        }
        let probes = self.confirmation_probes(&settings)?;
        let links = probes.minimum_links.to_string();
        let component = if settings.enabled { "fips" } else { "network" };
        let ipv6 = probes.ipv6.as_deref().unwrap_or("");
        self.run(
            "/etc/fips-recovery/health.sh",
            &[&probes.ip, &probes.name, component, &links, ipv6],
        )
        .map_err(|_| "confirmation_health_failed")?;
        self.guard(&["confirm", transaction_id])?;
        Ok(json!({"confirmed": true, "transaction_id": transaction_id}))
    }

    fn rollback(&self, transaction_id: &str) -> Result<Value, &'static str> {
        if !valid_transaction_id(transaction_id) {
            return Err("invalid_request");
        }
        let _lock = self.lock()?;
        let status = self.guard(&["status"])?;
        if status.split_whitespace().nth(1) != Some(transaction_id) {
            return Err("transaction_not_pending");
        }
        let mode = self
            .system_path("/etc/fips-recovery")
            .join(transaction_id)
            .join("backup/mode");
        if fs::read_to_string(mode)
            .map_err(|_| "transaction_not_pending")?
            .trim()
            != "config_only"
        {
            return Err("transaction_not_pending");
        }
        self.guard(&["rollback"])?;
        Ok(json!({"rolled_back": true, "transaction_id": transaction_id}))
    }

    fn recovery(&self) -> Result<Value, &'static str> {
        if !self.system_path("/etc/fips-recovery/guard.sh").is_file() {
            return Ok(json!({"pending": false, "guard_available": false}));
        }
        let status = self.guard(&["status"])?;
        let words: Vec<&str> = status.split_whitespace().collect();
        if words.len() == 3 && words[0] == "PENDING" && valid_package_transaction_id(words[1]) {
            let mode = self
                .system_path("/etc/fips-recovery")
                .join(words[1])
                .join("backup/mode");
            let mode = fs::read_to_string(mode).unwrap_or_default();
            let mode = mode.trim();
            if mode == "config_only" || mode == "packages" {
                return Ok(json!({"pending": true, "guard_available": true,
                                 "transaction_id": words[1], "mode": mode,
                                 "deadline_unix": words[2]}));
            }
        }
        Ok(json!({"pending": false, "guard_available": true}))
    }

    fn load(&self) -> Result<Settings, &'static str> {
        let file = match OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(self.state_dir.join("settings.json"))
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Settings::default());
            }
            Err(_) => return Err("configuration_unreadable"),
        };
        serde_json::from_reader(file.take(MAX_REQUEST as u64 + 1))
            .map_err(|_| "configuration_invalid")
    }

    fn lock(&self) -> Result<File, &'static str> {
        fs::create_dir_all(&self.state_dir).map_err(|_| "state_unavailable")?;
        let meta = fs::symlink_metadata(&self.state_dir).map_err(|_| "state_unavailable")?;
        if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } {
            return Err("unsafe_state_directory");
        }
        fs::set_permissions(&self.state_dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "state_unavailable")?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .custom_flags(libc::O_NOFOLLOW)
            .mode(0o600)
            .open(self.state_dir.join("lock"))
            .map_err(|_| "state_unavailable")?;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err("configuration_busy");
        }
        Ok(file)
    }
}

fn parse_request(request: &[u8]) -> Result<Request, &'static str> {
    let value: Value = serde_json::from_slice(request).map_err(|_| "invalid_request")?;
    let fields = value.as_object().ok_or("invalid_request")?;
    let operation = fields
        .get("operation")
        .and_then(Value::as_str)
        .ok_or("invalid_request")?;
    let allowed: &[&str] = match operation {
        "status" | "peers" | "diagnostics" | "configuration" | "recovery" => &["operation"],
        "validate" => &["operation", "settings"],
        "stage" => &["operation", "settings", "expected_revision"],
        "activate" => &["operation", "expected_revision"],
        "activate_package" => &["operation", "expected_revision", "transaction_id"],
        "confirm" => &["operation", "transaction_id"],
        "rollback" => &["operation", "transaction_id"],
        _ => return Err("invalid_request"),
    };
    if fields.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("invalid_request");
    }
    serde_json::from_value(value).map_err(|_| "invalid_request")
}

pub fn revision(settings: &Settings) -> String {
    Sha256::digest(serde_json::to_vec(settings).expect("settings serialize"))
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn valid_transaction_id(value: &str) -> bool {
    value.len() == 20
        && value.starts_with("cfg_")
        && value[4..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_package_transaction_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn atomic_json(path: &Path, data: &Value) -> Result<(), &'static str> {
    let mut bytes = serde_json::to_vec(data).map_err(|_| "configuration_write_failed")?;
    bytes.push(b'\n');
    atomic_bytes(path, &bytes)
}

fn atomic_bytes(path: &Path, data: &[u8]) -> Result<(), &'static str> {
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|_| "configuration_write_failed")?;
        file.write_all(data)
            .map_err(|_| "configuration_write_failed")?;
        file.sync_all().map_err(|_| "configuration_write_failed")?;
        fs::rename(&temporary, path).map_err(|_| "configuration_write_failed")?;
        File::open(path.parent().ok_or("configuration_write_failed")?)
            .and_then(|dir| dir.sync_all())
            .map_err(|_| "configuration_write_failed")
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn project(value: &Value, keys: &[&str]) -> Value {
    let mut object = serde_json::Map::new();
    for key in keys {
        if let Some(value) = value.get(key) {
            object.insert((*key).into(), value.clone());
        }
    }
    Value::Object(object)
}

fn query(path: &Path, command: &str) -> Result<Value, &'static str> {
    let mut stream = UnixStream::connect(path).map_err(|_| "daemon_unavailable")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| "daemon_unavailable")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| "daemon_unavailable")?;
    writeln!(stream, "{}", json!({"command": command})).map_err(|_| "daemon_unavailable")?;
    let mut line = Vec::new();
    BufReader::new(stream.take(MAX_RESPONSE + 1))
        .read_until(b'\n', &mut line)
        .map_err(|_| "daemon_timeout")?;
    if line.len() > MAX_RESPONSE as usize || line.last() != Some(&b'\n') {
        return Err("invalid_daemon_response");
    }
    let value: Value = serde_json::from_slice(&line).map_err(|_| "invalid_daemon_response")?;
    if value["status"] != "ok" {
        return Err("daemon_query_failed");
    }
    value.get("data").cloned().ok_or("invalid_daemon_response")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixListener;
    use tempfile::TempDir;

    fn backend(root: &TempDir) -> Backend {
        Backend {
            state_dir: root.path().join("etc/fips/router"),
            socket_path: root.path().join("socket"),
            system_root: root.path().to_path_buf(),
            package_activation_allowed: false,
        }
    }

    fn fake_activation_commands(root: &TempDir, fail_nft: bool) {
        let guard_dir = root.path().join("etc/fips-recovery");
        fs::create_dir_all(&guard_dir).unwrap();
        let guard = guard_dir.join("guard.sh");
        fs::write(
            &guard,
            r##"#!/bin/sh
dir=$(dirname "$0")
case "$1" in
    status) if [ -f "$dir/pending" ]; then echo "PENDING $(cat "$dir/pending") 999"; else echo NONE; fi ;;
    arm) echo "$2" > "$dir/pending"; mkdir -p "$dir/$2/backup"; echo config_only > "$dir/$2/backup/mode"; echo "ARMED $2" ;;
    confirm) test "$(cat "$dir/pending")" = "$2" || exit 1; rm "$dir/pending"; echo "CONFIRMED $2" ;;
    rollback) echo rollback > "$dir/rolled_back"; rm -f "$dir/pending"; echo ROLLED_BACK ;;
    *) exit 1 ;;
esac
"##,
        )
        .unwrap();
        fs::set_permissions(&guard, fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(
            guard_dir.join("probes.json"),
            r#"{"ip":"1.1.1.1","name":"example.com","minimum_links":1,"components":"fips,web_ui","ipv6":"2606:4700:4700::1111"}"#,
        )
        .unwrap();
        let health = guard_dir.join("health.sh");
        fs::write(
            &health,
            r#"#!/bin/sh
dir=$(dirname "$0")
echo "$*" >> "$dir/health-commands"
test ! -e "$dir/health-fail"
"#,
        )
        .unwrap();
        fs::set_permissions(&health, fs::Permissions::from_mode(0o700)).unwrap();
        let init_dir = root.path().join("etc/init.d");
        fs::create_dir_all(&init_dir).unwrap();
        let init = init_dir.join("fips");
        fs::write(
            &init,
            "#!/bin/sh\necho \"$1\" >> \"$(dirname \"$0\")/fips-commands\"\n",
        )
        .unwrap();
        fs::set_permissions(&init, fs::Permissions::from_mode(0o700)).unwrap();
        let gateway = init_dir.join("fips-gateway");
        fs::write(
            &gateway,
            "#!/bin/sh\necho \"$1\" >> \"$(dirname \"$0\")/gateway-commands\"\n",
        )
        .unwrap();
        fs::set_permissions(&gateway, fs::Permissions::from_mode(0o700)).unwrap();
        let firewall = init_dir.join("firewall");
        fs::write(
            &firewall,
            "#!/bin/sh\necho \"$1\" >> \"$(dirname \"$0\")/firewall-commands\"\n",
        )
        .unwrap();
        fs::set_permissions(&firewall, fs::Permissions::from_mode(0o700)).unwrap();
        let sbin = root.path().join("sbin");
        fs::create_dir_all(&sbin).unwrap();
        let uci = sbin.join("uci");
        fs::write(
            &uci,
            "#!/bin/sh\ncase \"$1 $2 $3\" in '-q get firewall.fips_mesh'|'-q get firewall.fips_lan'|'-q get firewall.fips_tcp'|'-q get firewall.fips_udp'|'-q get firewall.fips_icmp') exit 1;; esac\necho \"$*\" >> \"$(dirname \"$0\")/uci-commands\"\n",
        )
        .unwrap();
        fs::set_permissions(&uci, fs::Permissions::from_mode(0o700)).unwrap();
        let bin_dir = root.path().join("usr/sbin");
        fs::create_dir_all(&bin_dir).unwrap();
        let nft = bin_dir.join("nft");
        fs::write(
            &nft,
            format!(
                "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/nft-commands\"\n{}",
                if fail_nft {
                    "[ \"$1\" != -f ]\n"
                } else {
                    "exit 0\n"
                }
            ),
        )
        .unwrap();
        fs::set_permissions(&nft, fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[test]
    fn gateway_confirmation_requires_public_ipv6_probe() {
        let base =
            r#"{"ip":"1.1.1.1","name":"example.com","minimum_links":1,"components":"fips,web_ui"}"#;
        let probes: HealthProbes = serde_json::from_str(base).unwrap();
        assert!(probes.valid());
        let gateway = Settings {
            enabled: true,
            gateway_enabled: true,
            ..Settings::default()
        };
        assert!(!probes.valid_for(&gateway));
        assert!(
            serde_json::from_str::<HealthProbes>(
                r#"{"ip":"1.1.1.1","name":"example.com","minimum_links":1}"#
            )
            .is_err()
        );
        for components in ["", "fips,fips", "web_ui,fips", "fips,unknown"] {
            let probes: HealthProbes = serde_json::from_value(json!({
                "ip": "1.1.1.1", "name": "example.com", "minimum_links": 1,
                "components": components,
            }))
            .unwrap();
            assert!(!probes.valid(), "{components}");
        }
        for (address, expected) in [
            ("2606:4700:4700::1111", true),
            ("fd01::1", false),
            ("2001:db8::1", false),
            ("2001:2:f1b5::1", false),
        ] {
            let probes: HealthProbes = serde_json::from_value(json!({
                "ip": "1.1.1.1", "name": "example.com", "minimum_links": 1,
                "components": "fips,web_ui",
                "ipv6": address
            }))
            .unwrap();
            assert_eq!(probes.valid(), expected, "{address}");
            assert_eq!(probes.valid_for(&gateway), expected, "{address}");
        }
    }

    #[test]
    fn generated_config_passes_upstream_validation_and_persists_identity() {
        let settings = Settings::default();
        settings.validate().unwrap();
        assert_eq!(
            settings.daemon_config()["node"]["identity"]["persistent"],
            true
        );
        assert!(
            settings.daemon_config()["transports"]
                .get("ethernet")
                .is_none()
        );
        assert!(
            settings
                .mesh_firewall()
                .contains("iifname != \"fips0\" return")
        );
        assert!(settings.mesh_firewall().contains("counter drop"));
        assert!(!settings.mesh_firewall().contains("tcp dport 22 accept"));
    }

    #[test]
    fn rejects_injection_reserved_ports_and_invalid_keys() {
        assert!(!valid_endpoint("host;reboot:2121"));
        assert!(!valid_endpoint("host:0"));
        assert!(valid_endpoint("test-us01.fips.network:2121"));
        assert!(valid_endpoint("[2001:db8::1]:2121"));
        let mut settings = Settings {
            udp_port: 53,
            ..Settings::default()
        };
        assert!(settings.validate().is_err());
        settings.udp_port = 2121;
        settings.peers.push(Peer {
            npub: "npub1invalid".into(),
            transport: Transport::Udp,
            address: "host:2121".into(),
        });
        assert_eq!(settings.validate(), Err("invalid_peer_identity"));
    }

    #[test]
    fn staging_is_private_atomic_and_does_not_activate() {
        let root = TempDir::new().unwrap();
        let backend = backend(&root);
        let settings = Settings::default();
        let request = json!({"operation": "stage", "settings": settings, "expected_revision": revision(&settings)});
        let result = backend.handle(&serde_json::to_vec(&request).unwrap());
        assert_eq!(result["data"]["activated"], false);
        let candidate = backend.state_dir.join("candidate.json");
        assert_eq!(
            fs::metadata(candidate).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(!backend.state_dir.join("settings.json").exists());
        let mut stale = request;
        stale["expected_revision"] = json!("stale");
        assert_eq!(
            backend.handle(&serde_json::to_vec(&stale).unwrap())["error"],
            "revision_conflict"
        );
    }

    #[test]
    fn private_keys_and_unknown_fields_are_not_echoed() {
        let root = TempDir::new().unwrap();
        let request = br#"{"operation":"configuration","nsec":"secret-value"}"#;
        let output = backend(&root).handle(request).to_string();
        assert!(output.contains("invalid_request"));
        assert!(!output.contains("secret-value"));
        assert!(!output.contains("nsec"));
    }

    #[test]
    fn socket_projection_excludes_unexpected_sensitive_fields() {
        let root = TempDir::new().unwrap();
        let backend = backend(&root);
        let listener = UnixListener::bind(&backend.socket_path).unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut line = String::new();
            BufReader::new(socket.try_clone().unwrap())
                .read_line(&mut line)
                .unwrap();
            assert!(line.contains("show_status"));
            writeln!(
                socket,
                "{}",
                json!({"status":"ok","data":{"npub":"public", "state":"Running", "nsec":"secret"}})
            )
            .unwrap();
        });
        let output = backend.handle(br#"{"operation":"status"}"#);
        assert_eq!(output["data"]["npub"], "public");
        assert!(!output.to_string().contains("secret"));
        server.join().unwrap();
    }

    #[test]
    fn missing_daemon_is_explicitly_offline() {
        let root = TempDir::new().unwrap();
        assert_eq!(
            backend(&root).handle(br#"{"operation":"status"}"#)["data"]["state"],
            "offline"
        );
    }

    #[test]
    fn activation_requires_live_confirmation_and_keeps_identity_persistent() {
        let root = TempDir::new().unwrap();
        fake_activation_commands(&root, false);
        let backend = backend(&root);
        let settings = Settings {
            enabled: true,
            ..Settings::default()
        };
        let rev = revision(&settings);
        let stage = json!({"operation":"stage", "settings":settings,
                           "expected_revision":revision(&Settings::default())});
        let staged = backend.handle(&serde_json::to_vec(&stage).unwrap());
        assert_eq!(staged["status"], "ok", "{staged}");
        let result = backend.handle(
            &serde_json::to_vec(&json!({"operation":"activate", "expected_revision":rev})).unwrap(),
        );
        assert_eq!(result["status"], "ok", "{result}");
        let id = result["data"]["transaction_id"].as_str().unwrap();
        assert!(valid_transaction_id(id));
        assert_eq!(
            backend.handle(br#"{"operation":"recovery"}"#)["data"]["pending"],
            true
        );
        assert_eq!(
            serde_json::from_str::<Value>(
                &fs::read_to_string(backend.state_dir.join("settings.json")).unwrap()
            )
            .unwrap(),
            serde_json::to_value(&settings).unwrap()
        );
        assert_eq!(
            serde_json::from_str::<Value>(
                &fs::read_to_string(root.path().join("etc/fips/fips.yaml")).unwrap()
            )
            .unwrap()["node"]["identity"]["persistent"],
            true
        );
        assert_eq!(
            backend.handle(br#"{"operation":"confirm","transaction_id":"cfg_bad"}"#)["error"],
            "invalid_request"
        );
        let listener = UnixListener::bind(&backend.socket_path).unwrap();
        let server = std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = String::new();
                BufReader::new(socket.try_clone().unwrap())
                    .read_line(&mut request)
                    .unwrap();
                assert!(request.contains("show_status"));
                writeln!(
                    socket,
                    "{}",
                    json!({"status":"ok", "data":{"persistent":true}})
                )
                .unwrap();
            }
        });
        let early = backend.handle(
            &serde_json::to_vec(&json!({"operation":"confirm", "transaction_id":id})).unwrap(),
        );
        assert_eq!(early["error"], "identity_not_persistent");
        assert!(root.path().join("etc/fips-recovery/pending").exists());
        let key = root.path().join("etc/fips/fips.key");
        fs::write(&key, "test identity").unwrap();
        fs::set_permissions(&key, fs::Permissions::from_mode(0o600)).unwrap();
        let confirm = backend.handle(
            &serde_json::to_vec(&json!({"operation":"confirm", "transaction_id":id})).unwrap(),
        );
        assert_eq!(confirm["data"]["confirmed"], true, "{confirm}");
        assert!(!root.path().join("etc/fips-recovery/pending").exists());
        assert_eq!(
            backend.handle(br#"{"operation":"recovery"}"#)["data"]["pending"],
            false
        );
        server.join().unwrap();
    }

    #[test]
    fn activation_failure_invokes_guard_rollback() {
        let root = TempDir::new().unwrap();
        fake_activation_commands(&root, true);
        let backend = backend(&root);
        let settings = Settings {
            enabled: true,
            ..Settings::default()
        };
        let rev = revision(&settings);
        backend.handle(
            &serde_json::to_vec(&json!({"operation":"stage", "settings":settings,
                                       "expected_revision":revision(&Settings::default())}))
            .unwrap(),
        );
        let result = backend.handle(
            &serde_json::to_vec(&json!({"operation":"activate", "expected_revision":rev})).unwrap(),
        );
        assert_eq!(result["error"], "activation_failed");
        assert!(root.path().join("etc/fips-recovery/rolled_back").exists());
    }

    #[test]
    fn package_activation_uses_existing_guard_and_needs_local_cli_flag() {
        let root = TempDir::new().unwrap();
        fake_activation_commands(&root, false);
        let mut backend = backend(&root);
        let settings = Settings {
            enabled: true,
            ..Settings::default()
        };
        let candidate_revision = revision(&settings);
        let staged = backend.handle(
            &serde_json::to_vec(&json!({"operation":"stage", "settings":settings,
                                       "expected_revision":revision(&Settings::default())}))
            .unwrap(),
        );
        assert_eq!(staged["status"], "ok", "{staged}");
        let guard = root.path().join("etc/fips-recovery");
        fs::write(guard.join("pending"), "deploy1").unwrap();
        fs::create_dir_all(guard.join("deploy1/backup")).unwrap();
        fs::write(guard.join("deploy1/backup/mode"), "packages\n").unwrap();
        let recovery = backend.handle(br#"{"operation":"recovery"}"#);
        assert_eq!(recovery["data"]["pending"], true);
        assert_eq!(recovery["data"]["mode"], "packages");
        let request = serde_json::to_vec(&json!({"operation":"activate_package",
                                                "expected_revision":candidate_revision,
                                                "transaction_id":"deploy1"}))
        .unwrap();
        assert_eq!(backend.handle(&request)["error"], "operation_unavailable");
        backend.package_activation_allowed = true;
        fs::write(guard.join("deploy1/backup/mode"), "config_only\n").unwrap();
        assert_eq!(backend.handle(&request)["error"], "transaction_not_pending");
        fs::write(guard.join("deploy1/backup/mode"), "packages\n").unwrap();
        let wrong = backend.handle(
            &serde_json::to_vec(&json!({"operation":"activate_package",
                                       "expected_revision":candidate_revision,
                                       "transaction_id":"another"}))
            .unwrap(),
        );
        assert_eq!(wrong["error"], "transaction_not_pending");
        let applied = backend.handle(&request);
        assert_eq!(applied["status"], "ok", "{applied}");
        assert_eq!(applied["data"]["transaction_id"], "deploy1");
        assert_eq!(
            fs::read_to_string(guard.join("pending")).unwrap(),
            "deploy1"
        );
        assert!(!guard.join("deploy1/previous").exists());
        assert_eq!(
            backend.handle(br#"{"operation":"confirm","transaction_id":"deploy1"}"#)["error"],
            "invalid_request"
        );
    }

    #[test]
    fn explicit_rollback_is_limited_to_the_pending_configuration_transaction() {
        let root = TempDir::new().unwrap();
        fake_activation_commands(&root, false);
        let backend = backend(&root);
        let settings = Settings {
            enabled: true,
            ..Settings::default()
        };
        let rev = revision(&settings);
        backend.handle(
            &serde_json::to_vec(&json!({"operation":"stage", "settings":settings,
                                       "expected_revision":revision(&Settings::default())}))
            .unwrap(),
        );
        let activated = backend.handle(
            &serde_json::to_vec(&json!({"operation":"activate", "expected_revision":rev})).unwrap(),
        );
        assert_eq!(activated["status"], "ok", "{activated}");
        let uci = fs::read_to_string(root.path().join("sbin/uci-commands")).unwrap();
        assert!(uci.contains("set firewall.fips_mesh.device=fips0\n"));
        assert!(uci.contains("set firewall.fips_mesh.input=REJECT\n"));
        assert!(uci.contains("set firewall.fips_mesh.forward=REJECT\n"));
        assert!(uci.contains("set firewall.fips_icmp.proto=icmp\n"));
        assert!(uci.contains("set firewall.fips_icmp.target=ACCEPT\n"));
        assert!(uci.contains("commit firewall\n"));
        assert_eq!(
            fs::read_to_string(root.path().join("etc/init.d/firewall-commands")).unwrap(),
            "restart\n"
        );
        let id = activated["data"]["transaction_id"].as_str().unwrap();
        assert_eq!(
            backend.handle(br#"{"operation":"rollback","transaction_id":"cfg_0000000000000000"}"#)
                ["error"],
            "transaction_not_pending"
        );
        let rolled_back = backend.handle(
            &serde_json::to_vec(&json!({"operation":"rollback", "transaction_id":id})).unwrap(),
        );
        assert_eq!(rolled_back["data"]["rolled_back"], true);
        assert!(root.path().join("etc/fips-recovery/rolled_back").exists());
    }

    #[test]
    fn activation_refuses_to_repurpose_an_existing_firewall_section() {
        let root = TempDir::new().unwrap();
        fake_activation_commands(&root, false);
        let uci = root.path().join("sbin/uci");
        fs::write(
            &uci,
            "#!/bin/sh\ncase \"$3\" in firewall.fips_mesh) echo zone; exit 0;; firewall.fips_mesh.name) echo foreign; exit 0;; esac\necho \"$*\" >> \"$(dirname \"$0\")/uci-commands\"\n",
        )
        .unwrap();
        let backend = backend(&root);
        let settings = Settings {
            enabled: true,
            ..Settings::default()
        };
        let rev = revision(&settings);
        backend.handle(
            &serde_json::to_vec(&json!({"operation":"stage", "settings":settings,
                                       "expected_revision":revision(&Settings::default())}))
            .unwrap(),
        );
        let activated = backend.handle(
            &serde_json::to_vec(&json!({"operation":"activate", "expected_revision":rev})).unwrap(),
        );
        assert_eq!(activated["error"], "activation_failed");
        assert!(!root.path().join("sbin/uci-commands").exists());
        assert!(root.path().join("etc/fips-recovery/rolled_back").exists());
    }

    #[test]
    fn disabling_node_stops_service_and_confirms_without_a_daemon() {
        let root = TempDir::new().unwrap();
        fake_activation_commands(&root, false);
        let backend = backend(&root);
        fs::create_dir_all(&backend.state_dir).unwrap();
        let active = Settings {
            enabled: true,
            ..Settings::default()
        };
        atomic_json(
            &backend.state_dir.join("settings.json"),
            &serde_json::to_value(&active).unwrap(),
        )
        .unwrap();
        let disabled = Settings::default();
        let rev = revision(&disabled);
        let staged = backend.handle(
            &serde_json::to_vec(&json!({"operation":"stage", "settings":disabled,
                                       "expected_revision":revision(&active)}))
            .unwrap(),
        );
        assert_eq!(staged["status"], "ok", "{staged}");
        let activated = backend.handle(
            &serde_json::to_vec(&json!({"operation":"activate", "expected_revision":rev})).unwrap(),
        );
        assert_eq!(activated["status"], "ok", "{activated}");
        let commands = fs::read_to_string(root.path().join("etc/init.d/fips-commands")).unwrap();
        assert_eq!(commands, "stop\ndisable\n");
        let gateway_commands =
            fs::read_to_string(root.path().join("etc/init.d/gateway-commands")).unwrap();
        assert_eq!(gateway_commands, "stop\ndisable\n");
        let id = activated["data"]["transaction_id"].as_str().unwrap();
        let probe_path = root.path().join("etc/fips-recovery/probes.json");
        fs::remove_file(&probe_path).unwrap();
        let no_probes = backend.handle(
            &serde_json::to_vec(&json!({"operation":"confirm", "transaction_id":id})).unwrap(),
        );
        assert_eq!(no_probes["error"], "confirmation_probes_missing");
        assert!(root.path().join("etc/fips-recovery/pending").exists());
        fs::write(
            &probe_path,
            r#"{"ip":"1.1.1.1","name":"example.com","minimum_links":1,"components":"fips,web_ui"}"#,
        )
        .unwrap();
        fs::write(root.path().join("etc/fips-recovery/health-fail"), "").unwrap();
        let blocked = backend.handle(
            &serde_json::to_vec(&json!({"operation":"confirm", "transaction_id":id})).unwrap(),
        );
        assert_eq!(blocked["error"], "confirmation_health_failed");
        assert!(root.path().join("etc/fips-recovery/pending").exists());
        fs::remove_file(root.path().join("etc/fips-recovery/health-fail")).unwrap();
        let confirmed = backend.handle(
            &serde_json::to_vec(&json!({"operation":"confirm", "transaction_id":id})).unwrap(),
        );
        assert_eq!(confirmed["data"]["confirmed"], true);
        let probes =
            fs::read_to_string(root.path().join("etc/fips-recovery/health-commands")).unwrap();
        assert_eq!(
            probes,
            "1.1.1.1 example.com network 1 \n1.1.1.1 example.com network 1 \n"
        );
    }

    #[test]
    fn gateway_setting_starts_dedicated_service_under_guard() {
        let root = TempDir::new().unwrap();
        fake_activation_commands(&root, false);
        let backend = backend(&root);
        let settings = Settings {
            enabled: true,
            gateway_enabled: true,
            ..Settings::default()
        };
        let rev = revision(&settings);
        let staged = backend.handle(
            &serde_json::to_vec(&json!({"operation":"stage", "settings":settings,
                "expected_revision":revision(&Settings::default())}))
            .unwrap(),
        );
        assert_eq!(staged["status"], "ok", "{staged}");
        let activated = backend.handle(
            &serde_json::to_vec(&json!({"operation":"activate", "expected_revision":rev})).unwrap(),
        );
        assert_eq!(activated["status"], "ok", "{activated}");
        let gateway_commands =
            fs::read_to_string(root.path().join("etc/init.d/gateway-commands")).unwrap();
        assert_eq!(gateway_commands, "stop\ndisable\nenable\nstart\n");
        let uci = fs::read_to_string(root.path().join("sbin/uci-commands")).unwrap();
        assert!(uci.contains("set firewall.fips_lan=forwarding\n"));
        assert!(uci.contains("set firewall.fips_lan.src=lan\n"));
        assert!(uci.contains("set firewall.fips_lan.dest=fips_mesh\n"));
        assert!(!uci.contains("set firewall.fips_lan.src=fips_mesh"));
        assert_eq!(
            serde_json::from_str::<Value>(
                &fs::read_to_string(root.path().join("etc/fips/fips.yaml")).unwrap()
            )
            .unwrap()["gateway"]["enabled"],
            true
        );
    }

    #[test]
    fn gateway_activation_requires_public_probe_before_arming_guard() {
        let root = TempDir::new().unwrap();
        fake_activation_commands(&root, false);
        fs::write(
            root.path().join("etc/fips-recovery/probes.json"),
            r#"{"ip":"1.1.1.1","name":"example.com","minimum_links":1,"components":"fips"}"#,
        )
        .unwrap();
        let backend = backend(&root);
        let settings = Settings {
            enabled: true,
            gateway_enabled: true,
            ..Settings::default()
        };
        let rev = revision(&settings);
        let staged = backend.handle(
            &serde_json::to_vec(&json!({"operation":"stage", "settings":settings,
                "expected_revision":revision(&Settings::default())}))
            .unwrap(),
        );
        assert_eq!(staged["status"], "ok", "{staged}");
        let activated = backend.handle(
            &serde_json::to_vec(&json!({"operation":"activate", "expected_revision":rev})).unwrap(),
        );
        assert_eq!(activated["error"], "confirmation_probes_invalid");
        assert!(!root.path().join("etc/fips-recovery/pending").exists());
    }

    #[test]
    fn mesh_ports_have_explicit_fw4_input_rules() {
        let root = TempDir::new().unwrap();
        fake_activation_commands(&root, false);
        let backend = backend(&root);
        let settings = Settings {
            enabled: true,
            mesh_tcp_ports: vec![443, 8443],
            mesh_udp_ports: vec![5355],
            ..Settings::default()
        };
        let rev = revision(&settings);
        let staged = backend.handle(
            &serde_json::to_vec(&json!({"operation":"stage", "settings":settings,
                "expected_revision":revision(&Settings::default())}))
            .unwrap(),
        );
        assert_eq!(staged["status"], "ok", "{staged}");
        let activated = backend.handle(
            &serde_json::to_vec(&json!({"operation":"activate", "expected_revision":rev})).unwrap(),
        );
        assert_eq!(activated["status"], "ok", "{activated}");
        let commands = fs::read_to_string(root.path().join("sbin/uci-commands")).unwrap();
        assert!(commands.contains("set firewall.fips_mesh.input=REJECT\n"));
        assert!(commands.contains("set firewall.fips_tcp.dest_port=443 8443\n"));
        assert!(commands.contains("set firewall.fips_tcp.proto=tcp\n"));
        assert!(commands.contains("set firewall.fips_udp.dest_port=5355\n"));
        assert!(commands.contains("set firewall.fips_udp.proto=udp\n"));
    }

    #[test]
    fn disabling_gateway_removes_forwarding_and_recreates_mesh_zone() {
        let root = TempDir::new().unwrap();
        fake_activation_commands(&root, false);
        let uci = root.path().join("sbin/uci");
        fs::write(
            &uci,
            r#"#!/bin/sh
case "$3" in
    firewall.fips_mesh) echo zone; exit 0 ;;
    firewall.fips_mesh.name) echo fips_mesh; exit 0 ;;
    firewall.fips_mesh.device) echo fips0; exit 0 ;;
    firewall.fips_lan) echo forwarding; exit 0 ;;
    firewall.fips_lan.src) echo lan; exit 0 ;;
    firewall.fips_lan.dest) echo fips_mesh; exit 0 ;;
    firewall.fips_tcp|firewall.fips_udp|firewall.fips_icmp) exit 1 ;;
esac
echo "$*" >> "$(dirname "$0")/uci-commands"
"#,
        )
        .unwrap();
        let backend = backend(&root);
        fs::create_dir_all(&backend.state_dir).unwrap();
        let active = Settings {
            enabled: true,
            gateway_enabled: true,
            ..Settings::default()
        };
        atomic_json(
            &backend.state_dir.join("settings.json"),
            &serde_json::to_value(&active).unwrap(),
        )
        .unwrap();
        let disabled_gateway = Settings {
            enabled: true,
            ..Settings::default()
        };
        let rev = revision(&disabled_gateway);
        let staged = backend.handle(
            &serde_json::to_vec(&json!({"operation":"stage", "settings":disabled_gateway,
                                       "expected_revision":revision(&active)}))
            .unwrap(),
        );
        assert_eq!(staged["status"], "ok", "{staged}");
        let activated = backend.handle(
            &serde_json::to_vec(&json!({"operation":"activate", "expected_revision":rev})).unwrap(),
        );
        assert_eq!(activated["status"], "ok", "{activated}");
        let commands = fs::read_to_string(root.path().join("sbin/uci-commands")).unwrap();
        assert!(commands.starts_with("delete firewall.fips_mesh\ndelete firewall.fips_lan\n"));
        assert!(commands.contains("set firewall.fips_mesh.device=fips0\n"));
        assert!(!commands.contains("set firewall.fips_lan=forwarding\n"));
    }
}
