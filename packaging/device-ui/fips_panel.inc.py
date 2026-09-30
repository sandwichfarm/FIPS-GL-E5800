

# Local FIPS integration. Private identity material stays inside the backend.
FIPS_STAGED_REVISION = None


def fips_request(operation, **fields):
    executable = os.environ.get("FIPS_ROUTER_ADMIN", "/usr/bin/fips-router-admin")
    try:
        request = json.dumps({"operation": operation, **fields})
        result = subprocess.run([executable], input=request, text=True,
                                capture_output=True,
                                timeout=12 if operation == "activate" else 3,
                                check=False)
        response = json.loads(result.stdout)
        if response.get("status") != "ok":
            raise ValueError(response.get("error", "FIPS unavailable"))
        return response["data"]
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError):
        if operation == "status":
            return {"state": "offline"}
        raise ValueError("FIPS unavailable or request failed")


def panel_fips(conn_type=None, cell_signal=None):
    img, d = new_canvas()
    accent = (68, 164, 190)
    draw_header(d, "FIPS", accent, conn_type, cell_signal)
    status = fips_request("status")
    try:
        settings = fips_request("configuration")["settings"]
        configured = bool(settings["enabled"])
    except (ValueError, KeyError):
        configured = None
    try:
        recovery = fips_request("recovery")
        pending = bool(recovery.get("pending"))
        pending_mode = recovery.get("mode", "config_only") if pending else None
    except ValueError:
        pending = False
        pending_mode = None
    state = str(status.get("state", "offline"))
    state_color = FG if state.lower() == "running" else (236, 150, 110)
    d.text((16, 55), "Node", font=font("default_medium", 13), fill=DIM)
    d.text((16, 77), state.upper(), font=font("default_bold", 22), fill=state_color)
    d.text((16, 114), "Mesh address", font=font("default_medium", 12), fill=DIM)
    address = str(status.get("ipv6_addr", "Unavailable"))
    d.text((16, 132), address[:20], font=font("default_medium", 11), fill=FG)
    if len(address) > 20:
        d.text((16, 147), address[20:], font=font("default_medium", 11), fill=FG)
    d.text((16, 173), "Peers", font=font("default_medium", 12), fill=DIM)
    d.text((16, 191), str(status.get("peer_count", "—")),
           font=font("default_bold", 18), fill=FG)
    identity = status.get("npub")
    if identity:
        identity = str(identity)
        for row, start in enumerate(range(0, len(identity), 23)):
            d.text((16, 207 + row * 10), identity[start:start + 23],
                   font=font("default_medium", 9), fill=FG)
    if pending_mode == "packages":
        label = "Deploy pending"
    elif pending:
        label = "Roll back pending"
    elif FIPS_STAGED_REVISION:
        label = "Apply staged change"
    elif configured is None:
        label = "Configuration unavailable"
    else:
        label = "Stage disable" if configured else "Stage enable"
    d.rounded_rectangle([16, 242, W - 16, 280], radius=8,
                        fill=(22, 42, 53), outline=accent, width=1)
    centered_text(d, W / 2, 252, label, font("default_bold", 14), FG)
    draw_page_dots(d, PANEL_NAMES.index("fips"))
    return img


def hit_main_fips(x, y):
    if 16 <= x <= W - 16 and 242 <= y <= 280:
        return "stage_toggle"
    return None


def fips_toggle_action():
    global FIPS_STAGED_REVISION
    try:
        recovery = fips_request("recovery")
        if recovery.get("pending"):
            if recovery.get("mode") == "packages":
                return "Confirm from controller."
            fips_request("rollback", transaction_id=recovery["transaction_id"])
            FIPS_STAGED_REVISION = None
            return "Previous FIPS setup restored."
        if FIPS_STAGED_REVISION:
            fips_request("activate", expected_revision=FIPS_STAGED_REVISION)
            FIPS_STAGED_REVISION = None
            return "Applied. Confirm on web in 3 min."
        configuration = fips_request("configuration")
        settings = configuration["settings"]
        settings["enabled"] = not settings["enabled"]
        if not settings["enabled"]:
            settings["gateway_enabled"] = False
        candidate = fips_request("stage", settings=settings,
                                 expected_revision=configuration["revision"])
        FIPS_STAGED_REVISION = candidate["revision"]
        return "Staged. Tap again to apply."
    except (ValueError, KeyError, TypeError):
        return "FIPS change failed."
