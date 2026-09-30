//! Minimal RFC 4191 route advertisement for the FIPS gateway pool.
//!
//! The kernel fills the ICMPv6 checksum before transmission. Router Lifetime
//! stays zero so this packet never advertises a default route.

use std::net::Ipv6Addr;

pub const ROUTE_LIFETIME_SECONDS: u32 = 90;
pub const ADVERTISEMENT_INTERVAL_SECONDS: i32 = 30;

pub fn packet(route_lifetime: u32) -> [u8; 40] {
    let mut bytes = [0u8; 40];
    bytes[0] = 134; // ICMPv6 Router Advertisement, code zero.
    bytes[16] = 24; // RFC 4191 Route Information Option.
    bytes[17] = 3; // 24 bytes, in eight-byte units.
    bytes[18] = 112;
    bytes[20..24].copy_from_slice(&route_lifetime.to_be_bytes());
    bytes[24] = 0xfd;
    bytes[25] = 0x01; // fd01::/112; remaining prefix bits are zero.
    bytes
}

/// Validate a Router Solicitation before sending a route-only reply.
/// The kernel checks the ICMPv6 checksum on the raw receive socket.
pub fn valid_solicitation(bytes: &[u8], source: Ipv6Addr, hop_limit: i32) -> bool {
    if hop_limit != 255
        || (!source.is_unspecified() && !source.is_unicast_link_local())
        || bytes.len() < 8
        || bytes[0] != 133
        || bytes[1] != 0
    {
        return false;
    }
    let mut options = &bytes[8..];
    while !options.is_empty() {
        if options.len() < 2 || options[1] == 0 {
            return false;
        }
        let length = usize::from(options[1]) * 8;
        if options.len() < length || (source.is_unspecified() && options[0] == 1) {
            return false;
        }
        options = &options[length..];
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertises_only_the_fips_route_and_no_default_router() {
        let bytes = packet(ROUTE_LIFETIME_SECONDS);
        assert_eq!(
            &bytes[..16],
            &[134, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        );
        assert_eq!(&bytes[16..24], &[24, 3, 112, 0, 0, 0, 0, 90]);
        assert_eq!(
            &bytes[24..],
            &[0xfd, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        );
    }

    #[test]
    fn withdrawal_expires_the_specific_route() {
        let bytes = packet(0);
        assert_eq!(&bytes[6..8], &[0, 0]);
        assert_eq!(&bytes[20..24], &[0, 0, 0, 0]);
        assert_eq!(&bytes[24..26], &[0xfd, 0x01]);
    }

    #[test]
    fn accepts_valid_solicitations() {
        let local = "fe80::abcd".parse().unwrap();
        assert!(valid_solicitation(&[133, 0, 0, 0, 0, 0, 0, 0], local, 255));
        assert!(valid_solicitation(
            &[133, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0],
            local,
            255
        ));
        assert!(valid_solicitation(
            &[133, 0, 0, 0, 0, 0, 0, 0],
            Ipv6Addr::UNSPECIFIED,
            255
        ));
    }

    #[test]
    fn rejects_invalid_solicitations() {
        let local = "fe80::abcd".parse().unwrap();
        let valid = [133, 0, 0, 0, 0, 0, 0, 0];
        assert!(!valid_solicitation(&valid, local, 64));
        assert!(!valid_solicitation(
            &valid,
            "2001:db8::1".parse().unwrap(),
            255
        ));
        assert!(!valid_solicitation(&valid[..7], local, 255));
        assert!(!valid_solicitation(&[133, 1, 0, 0, 0, 0, 0, 0], local, 255));
        assert!(!valid_solicitation(&[134, 0, 0, 0, 0, 0, 0, 0], local, 255));
        assert!(!valid_solicitation(
            &[133, 0, 0, 0, 0, 0, 0, 0, 1, 0],
            local,
            255
        ));
        assert!(!valid_solicitation(
            &[133, 0, 0, 0, 0, 0, 0, 0, 1, 1],
            local,
            255
        ));
        assert!(!valid_solicitation(
            &[133, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0],
            Ipv6Addr::UNSPECIFIED,
            255
        ));
    }
}
