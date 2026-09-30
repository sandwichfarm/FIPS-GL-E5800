//! Linux sender for a single route-only LAN advertisement.

use fips_router_admin::route_advertisement::{
    ADVERTISEMENT_INTERVAL_SECONDS, ROUTE_LIFETIME_SECONDS, packet, valid_solicitation,
};
use std::ffi::CString;
use std::io;
use std::mem::size_of;
use std::net::Ipv6Addr;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static STOP: AtomicBool = AtomicBool::new(false);

extern "C" fn stop_on_signal(_: libc::c_int) {
    STOP.store(true, Ordering::Relaxed);
}

fn set_option(
    fd: &OwnedFd,
    level: libc::c_int,
    name: libc::c_int,
    value: libc::c_int,
) -> io::Result<()> {
    // SAFETY: `value` is a live, correctly sized C integer for the call.
    let result = unsafe {
        libc::setsockopt(
            fd.as_raw_fd(),
            level,
            name,
            &value as *const _ as *const libc::c_void,
            size_of::<libc::c_int>() as libc::socklen_t,
        )
    };
    if result < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn socket_address(address: Ipv6Addr, interface_index: u32) -> libc::sockaddr_in6 {
    libc::sockaddr_in6 {
        sin6_family: libc::AF_INET6 as libc::sa_family_t,
        sin6_port: 0,
        sin6_flowinfo: 0,
        sin6_addr: libc::in6_addr {
            s6_addr: address.octets(),
        },
        sin6_scope_id: interface_index,
    }
}

fn send(fd: &OwnedFd, destination: &libc::sockaddr_in6, lifetime: u32) -> io::Result<()> {
    let message = packet(lifetime);
    // SAFETY: the fixed-size packet and destination address remain live for sendto.
    let sent = unsafe {
        libc::sendto(
            fd.as_raw_fd(),
            message.as_ptr() as *const libc::c_void,
            message.len(),
            0,
            destination as *const _ as *const libc::sockaddr,
            size_of::<libc::sockaddr_in6>() as libc::socklen_t,
        )
    };
    if sent < 0 {
        return Err(io::Error::last_os_error());
    }
    if sent as usize != message.len() {
        return Err(io::Error::new(
            io::ErrorKind::WriteZero,
            "incomplete router advertisement",
        ));
    }
    Ok(())
}

fn receive_socket(interface: &CString, interface_index: u32) -> io::Result<OwnedFd> {
    // SAFETY: a successful socket call returns a new owned descriptor.
    let raw_fd = unsafe {
        libc::socket(
            libc::AF_INET6,
            libc::SOCK_RAW | libc::SOCK_CLOEXEC,
            libc::IPPROTO_ICMPV6,
        )
    };
    if raw_fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: raw_fd is fresh and is not owned elsewhere.
    let fd = unsafe { OwnedFd::from_raw_fd(raw_fd) };
    // SAFETY: interface is a live NUL-terminated C string.
    if unsafe {
        libc::setsockopt(
            fd.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_BINDTODEVICE,
            interface.as_ptr() as *const libc::c_void,
            interface.as_bytes_with_nul().len() as libc::socklen_t,
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    set_option(&fd, libc::IPPROTO_IPV6, libc::IPV6_RECVHOPLIMIT, 1)?;
    set_option(&fd, libc::IPPROTO_IPV6, libc::IPV6_RECVPKTINFO, 1)?;
    let membership = libc::ipv6_mreq {
        ipv6mr_multiaddr: libc::in6_addr {
            s6_addr: "ff02::2"
                .parse::<Ipv6Addr>()
                .expect("fixed multicast address")
                .octets(),
        },
        ipv6mr_interface: interface_index,
    };
    // SAFETY: membership is a live IPv6 multicast request of the declared size.
    if unsafe {
        libc::setsockopt(
            fd.as_raw_fd(),
            libc::IPPROTO_IPV6,
            libc::IPV6_ADD_MEMBERSHIP,
            &membership as *const _ as *const libc::c_void,
            size_of::<libc::ipv6_mreq>() as libc::socklen_t,
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(fd)
}

fn receive_solicitation(fd: &OwnedFd, interface_index: u32) -> io::Result<Option<Ipv6Addr>> {
    let mut bytes = [0u8; 2048];
    let mut source: libc::sockaddr_in6 = unsafe { std::mem::zeroed() };
    // CMSG headers require native alignment, so use machine words for storage.
    let mut control = [0 as libc::c_long; 16];
    let mut iovec = libc::iovec {
        iov_base: bytes.as_mut_ptr() as *mut libc::c_void,
        iov_len: bytes.len(),
    };
    let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
    message.msg_name = &mut source as *mut _ as *mut libc::c_void;
    message.msg_namelen = size_of::<libc::sockaddr_in6>() as libc::socklen_t;
    message.msg_iov = &mut iovec;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr() as *mut libc::c_void;
    message.msg_controllen = size_of::<[libc::c_long; 16]>() as _;
    // SAFETY: all receive buffers stay live and correctly sized through recvmsg.
    let received = unsafe { libc::recvmsg(fd.as_raw_fd(), &mut message, 0) };
    if received < 0 {
        return Err(io::Error::last_os_error());
    }
    if message.msg_flags & (libc::MSG_TRUNC | libc::MSG_CTRUNC) != 0
        || message.msg_namelen as usize != size_of::<libc::sockaddr_in6>()
        || source.sin6_family != libc::AF_INET6 as libc::sa_family_t
    {
        return Ok(None);
    }
    let mut hop_limit = None;
    let mut incoming_interface = None;
    // SAFETY: recvmsg initialized control data; CMSG helpers stay within msg_controllen.
    unsafe {
        let mut header = libc::CMSG_FIRSTHDR(&message);
        while !header.is_null() {
            let item = &*header;
            if item.cmsg_level == libc::IPPROTO_IPV6 {
                if item.cmsg_type == libc::IPV6_HOPLIMIT
                    && item.cmsg_len as usize
                        >= libc::CMSG_LEN(size_of::<libc::c_int>() as u32) as usize
                {
                    hop_limit = Some(std::ptr::read_unaligned(
                        libc::CMSG_DATA(header) as *const libc::c_int
                    ));
                } else if item.cmsg_type == libc::IPV6_PKTINFO
                    && item.cmsg_len as usize
                        >= libc::CMSG_LEN(size_of::<libc::in6_pktinfo>() as u32) as usize
                {
                    incoming_interface = Some(
                        std::ptr::read_unaligned(
                            libc::CMSG_DATA(header) as *const libc::in6_pktinfo
                        )
                        .ipi6_ifindex,
                    );
                }
            }
            header = libc::CMSG_NXTHDR(&message, header);
        }
    }
    let source_address = Ipv6Addr::from(source.sin6_addr.s6_addr);
    if incoming_interface != Some(interface_index)
        || !valid_solicitation(
            &bytes[..received as usize],
            source_address,
            hop_limit.unwrap_or(-1),
        )
    {
        return Ok(None);
    }
    Ok(Some(source_address))
}

fn delay_for_solicited_multicast() -> Duration {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| time.subsec_nanos());
    Duration::from_millis(u64::from(nanos % 500))
}

pub fn run(source: Ipv6Addr) -> io::Result<()> {
    if !source.is_unicast_link_local() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "source must be link-local",
        ));
    }
    let interface = CString::new("br-lan").expect("fixed interface has no NUL");
    // SAFETY: interface is a NUL-terminated C string.
    let interface_index = unsafe { libc::if_nametoindex(interface.as_ptr()) };
    if interface_index == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: a successful socket call returns a new owned descriptor.
    let raw_fd = unsafe {
        libc::socket(
            libc::AF_INET6,
            libc::SOCK_RAW | libc::SOCK_CLOEXEC,
            libc::IPPROTO_ICMPV6,
        )
    };
    if raw_fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: raw_fd was created above and is not owned elsewhere.
    let fd = unsafe { OwnedFd::from_raw_fd(raw_fd) };
    // SAFETY: `interface` is live and its length includes the terminating NUL.
    if unsafe {
        libc::setsockopt(
            fd.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_BINDTODEVICE,
            interface.as_ptr() as *const libc::c_void,
            interface.as_bytes_with_nul().len() as libc::socklen_t,
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    set_option(&fd, libc::IPPROTO_RAW, libc::IPV6_CHECKSUM, 2)?;
    set_option(&fd, libc::IPPROTO_IPV6, libc::IPV6_MULTICAST_HOPS, 255)?;
    set_option(&fd, libc::IPPROTO_IPV6, libc::IPV6_UNICAST_HOPS, 255)?;
    set_option(&fd, libc::IPPROTO_IPV6, libc::IPV6_MULTICAST_LOOP, 0)?;
    let receive = receive_socket(&interface, interface_index)?;

    let local = socket_address(source, interface_index);
    // SAFETY: the local address has the correct sockaddr type and size.
    if unsafe {
        libc::bind(
            fd.as_raw_fd(),
            &local as *const _ as *const libc::sockaddr,
            size_of::<libc::sockaddr_in6>() as libc::socklen_t,
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    let destination = socket_address(
        "ff02::1".parse().expect("fixed multicast address"),
        interface_index,
    );
    // SAFETY: signal handlers only store an atomic flag; descriptor I/O stays in this thread.
    unsafe {
        let handler = stop_on_signal as *const () as libc::sighandler_t;
        if libc::signal(libc::SIGTERM, handler) == libc::SIG_ERR
            || libc::signal(libc::SIGINT, handler) == libc::SIG_ERR
        {
            return Err(io::Error::last_os_error());
        }
    }
    let mut advertised = false;
    let mut last_multicast = None::<Instant>;
    let mut next_regular = Instant::now();
    let mut pending_multicast = None::<Instant>;
    while !STOP.load(Ordering::Relaxed) {
        let ready = UnixStream::connect("/run/fips/gateway.sock").is_ok();
        if ready {
            let now = Instant::now();
            if now >= next_regular {
                send(&fd, &destination, ROUTE_LIFETIME_SECONDS)?;
                advertised = true;
                last_multicast = Some(now);
                next_regular = now + Duration::from_secs(ADVERTISEMENT_INTERVAL_SECONDS as u64);
                pending_multicast = None;
            } else if pending_multicast.is_some_and(|due| now >= due) {
                send(&fd, &destination, ROUTE_LIFETIME_SECONDS)?;
                last_multicast = Some(now);
                next_regular = now + Duration::from_secs(ADVERTISEMENT_INTERVAL_SECONDS as u64);
                pending_multicast = None;
            }
        } else if advertised {
            send(&fd, &destination, 0)?;
            advertised = false;
            let withdrawn_at = Instant::now();
            last_multicast = Some(withdrawn_at);
            next_regular = withdrawn_at + Duration::from_secs(3);
            pending_multicast = None;
        }
        // Recheck gateway health every second, and wake earlier for pending RAs.
        let now = Instant::now();
        let mut timeout = Duration::from_secs(1);
        if ready {
            timeout = timeout.min(next_regular.saturating_duration_since(now));
            if let Some(due) = pending_multicast {
                timeout = timeout.min(due.saturating_duration_since(now));
            }
        }
        let mut poll_fd = libc::pollfd {
            fd: receive.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: poll_fd is live for this interruptible poll call.
        let result = unsafe {
            libc::poll(
                &mut poll_fd,
                1,
                timeout.as_millis().min(1000) as libc::c_int,
            )
        };
        if result < 0 && io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
            return Err(io::Error::last_os_error());
        }
        if result > 0
            && poll_fd.revents & libc::POLLIN != 0
            && !STOP.load(Ordering::Relaxed)
            && let Some(source_address) = receive_solicitation(&receive, interface_index)?
        {
            let gateway_still_ready =
                ready && UnixStream::connect("/run/fips/gateway.sock").is_ok();
            if gateway_still_ready && !source_address.is_unspecified() {
                let target = socket_address(source_address, interface_index);
                send(&fd, &target, ROUTE_LIFETIME_SECONDS)?;
            } else if gateway_still_ready {
                let now = Instant::now();
                let minimum = last_multicast.map_or(now, |last| last + Duration::from_secs(3));
                let due = minimum.max(now + delay_for_solicited_multicast());
                pending_multicast = Some(pending_multicast.map_or(due, |current| current.min(due)));
            }
        }
    }
    if advertised {
        send(&fd, &destination, 0)?;
    }
    Ok(())
}
