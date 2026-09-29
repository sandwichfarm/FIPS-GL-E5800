//! Shared, bounded management contract for the web and touchscreen clients.
//! It never reads private identity files or returns unrestricted daemon data.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::SocketAddr;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
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
}

pub struct Backend {
    pub state_dir: PathBuf,
    pub socket_path: PathBuf,
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
            Request::Status => match query(&self.socket_path, "show_status") {
                Ok(data) => Ok(project(
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
                )),
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
                Ok(json!({"daemon_reachable": true, "node": project(&data,
                    &["state", "persistent", "tun_state", "transport_count", "peer_count"]),
                    "configuration_valid": self.load().and_then(|s| s.validate()).is_ok()}))
            }
        }
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
        "status" | "peers" | "diagnostics" | "configuration" => &["operation"],
        "validate" => &["operation", "settings"],
        "stage" => &["operation", "settings", "expected_revision"],
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

fn atomic_json(path: &Path, data: &Value) -> Result<(), &'static str> {
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|_| "configuration_write_failed")?;
        serde_json::to_writer(&mut file, data).map_err(|_| "configuration_write_failed")?;
        file.write_all(b"\n")
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
            state_dir: root.path().join("state"),
            socket_path: root.path().join("socket"),
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
}
