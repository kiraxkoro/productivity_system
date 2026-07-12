// Live checks for the macOS blocking port, meant for a real Mac (CI's macOS
// runner). They write /etc/hosts and kill a real browser, so they're ignored
// by default; CI grants hosts access first (the same ACL the app's one-time
// admin prompt creates) and then runs:
//   cargo test --test mac_blocking -- --ignored
#![cfg(target_os = "macos")]

use std::process::Command;
use std::time::{Duration, Instant};

/// What the OS resolver (not a browser, not a cache we control) says.
fn lookup(domain: &str) -> String {
    let out = Command::new("dscacheutil")
        .args(["-q", "host", "-a", "name", domain])
        .output()
        .expect("dscacheutil should run");
    String::from_utf8_lossy(&out.stdout).to_string()
}

fn wait_for(mut cond: impl FnMut() -> bool, secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(secs);
    loop {
        if cond() {
            return true;
        }
        if Instant::now() > deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[test]
#[ignore = "writes /etc/hosts — needs the access grant CI performs"]
fn hosts_blocking_round_trip_on_real_macos() {
    focus_os_lib::hosts_blocker::sync(&["youtube.com".into()]);
    let hosts = std::fs::read_to_string("/etc/hosts").expect("hosts readable");
    assert!(
        hosts.contains("0.0.0.0 youtube.com") && hosts.contains("0.0.0.0 www.youtube.com"),
        "block entries should be in /etc/hosts:\n{hosts}"
    );
    assert!(
        wait_for(|| lookup("youtube.com").contains("0.0.0.0"), 20),
        "resolver should hand out 0.0.0.0 for a blocked domain; got:\n{}",
        lookup("youtube.com")
    );

    focus_os_lib::hosts_blocker::sync(&[]);
    let hosts = std::fs::read_to_string("/etc/hosts").expect("hosts readable");
    assert!(
        !hosts.contains("youtube.com") && !hosts.contains("focus-os"),
        "cleanup should remove every trace:\n{hosts}"
    );
    assert!(
        wait_for(
            || {
                let r = lookup("youtube.com");
                r.contains("ip_address") && !r.contains("0.0.0.0")
            },
            20
        ),
        "resolver should return real addresses again; got:\n{}",
        lookup("youtube.com")
    );
}

#[test]
#[ignore = "launches and kills a real browser"]
fn close_process_translates_windows_names_to_mac_apps() {
    if !std::path::Path::new("/Applications/Google Chrome.app").exists() {
        eprintln!("Google Chrome not installed on this machine — nothing to test");
        return;
    }
    // spawn the binary directly: `open -a` goes through LaunchServices,
    // which can wait forever on a first-run browser in CI
    Command::new("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        .args(["--no-first-run", "--no-default-browser-check", "about:blank"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("Chrome should spawn");
    assert!(wait_for(chrome_running, 20), "Chrome should appear in the process list");

    // the exact string a block stores on Windows
    focus_os_lib::commands::schedules::close_process("chrome.exe")
        .expect("close_process should succeed");
    assert!(
        wait_for(|| !chrome_running(), 20),
        "close_process(\"chrome.exe\") should have killed Google Chrome"
    );
}

fn chrome_running() -> bool {
    // same arg-tolerant shape close_process uses: Chrome launched with
    // flags/URLs doesn't end its command line with its own binary name
    Command::new("pgrep")
        .args(["-f", "MacOS/Google Chrome([[:space:]]|$)"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
