use fips_router_admin::{Backend, MAX_REQUEST};
use std::io::Read;
use std::path::PathBuf;

fn main() {
    // Alternate paths are process arguments for local development, never API inputs.
    let mut args = std::env::args().skip(1);
    let mut backend = Backend {
        state_dir: PathBuf::from("/etc/fips/router"),
        socket_path: PathBuf::from("/run/fips/control.sock"),
    };
    while let Some(arg) = args.next() {
        let Some(value) = args.next() else {
            std::process::exit(2)
        };
        match arg.as_str() {
            "--state-dir" => backend.state_dir = value.into(),
            "--socket" => backend.socket_path = value.into(),
            _ => std::process::exit(2),
        }
    }
    let mut input = Vec::new();
    if std::io::stdin()
        .take(MAX_REQUEST as u64 + 1)
        .read_to_end(&mut input)
        .is_err()
    {
        println!("{{\"status\":\"error\",\"error\":\"request_read_failed\"}}");
        std::process::exit(1);
    }
    let result = backend.handle(&input);
    println!("{result}");
    if result["status"] != "ok" {
        std::process::exit(1);
    }
}
