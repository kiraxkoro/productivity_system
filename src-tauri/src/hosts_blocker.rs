// Person A: extension-free website blocking. The active block's closeTab
// domains are written into the Windows hosts file (pointed at 0.0.0.0), so
// blocked sites stop resolving in EVERY browser — incognito and "switch
// browser" escape hatches included. The section is removed the moment the
// block ends, the user pauses, or the app quits from the tray.
//
// The hosts file is admin-protected, so the first write triggers a one-time
// UAC prompt that grants this user permanent write access to it (icacls).
// We ask at block-save time — when the user is at the keyboard — never at
// block-start time. If they decline, website blocking silently falls back
// to the browser extension (app blocking is unaffected).
//
// Whitelist-mode blocks ("block every site except…") stay extension-only:
// a hosts file can't express "everything except X".

const BEGIN: &str = "# >>> focus-os website block — auto-managed, do not edit >>>";
const END: &str = "# <<< focus-os website block <<<";

/// Make the hosts file match `domains` (empty = remove our section entirely).
/// No-ops when the file already matches, so calling this often is free.
#[cfg(target_os = "windows")]
pub fn sync(domains: &[String]) {
    let path = hosts_path();
    let current = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => {
            eprintln!("[hosts] read failed: {e}");
            return;
        }
    };
    let Some(new_content) = rewrite(&current, domains) else {
        return; // already in the desired state
    };
    let mut result = std::fs::write(&path, &new_content);
    if matches!(&result, Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied) {
        if ensure_write_access() {
            result = std::fs::write(&path, &new_content);
        }
    }
    match result {
        Ok(()) => flush_dns(),
        Err(e) => eprintln!("[hosts] write failed (extension remains the fallback): {e}"),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn sync(_domains: &[String]) {}

/// True when we can write the hosts file, prompting the one-time UAC grant
/// if needed. Prompts at most once per app run.
#[cfg(target_os = "windows")]
pub fn ensure_write_access() -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};
    static PROMPTED: AtomicBool = AtomicBool::new(false);

    let path = hosts_path();
    if std::fs::OpenOptions::new().append(true).open(&path).is_ok() {
        return true;
    }
    if PROMPTED.swap(true, Ordering::SeqCst) {
        return false; // already asked this run; don't nag
    }

    let Ok(user) = std::env::var("USERNAME") else {
        return false;
    };
    // A .cmd file dodges the quoting maze of nesting icacls args inside a
    // PowerShell -Command string; RunAs is what raises the UAC prompt.
    let script = std::env::temp_dir().join("focus-os-grant-hosts.cmd");
    let body = format!("@echo off\r\nicacls \"{}\" /grant \"{user}:M\"\r\n", path.display());
    if std::fs::write(&script, body).is_err() {
        return false;
    }
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let status = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Start-Process -FilePath '{}' -Verb RunAs -Wait -WindowStyle Hidden",
                script.display()
            ),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    let _ = std::fs::remove_file(&script);
    if !matches!(status, Ok(s) if s.success()) {
        return false; // user clicked "No" on UAC, or launch failed
    }
    std::fs::OpenOptions::new().append(true).open(&path).is_ok()
}

#[cfg(not(target_os = "windows"))]
pub fn ensure_write_access() -> bool {
    true
}

#[cfg(target_os = "windows")]
fn hosts_path() -> std::path::PathBuf {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    std::path::PathBuf::from(root).join(r"System32\drivers\etc\hosts")
}

/// Blocked lookups linger in the OS resolver cache; flush so blocks (and
/// unblocks) take effect within seconds instead of minutes.
#[cfg(target_os = "windows")]
fn flush_dns() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("ipconfig")
        .arg("/flushdns")
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

/// Returns the full new hosts content, or None when `current` already
/// matches `domains`. Everything outside our BEGIN/END markers is preserved
/// byte-for-byte; the section is regenerated from scratch every time.
fn rewrite(current: &str, domains: &[String]) -> Option<String> {
    let mut kept: Vec<&str> = Vec::new();
    let mut in_section = false;
    for line in current.lines() {
        if line.trim() == BEGIN {
            in_section = true;
            continue;
        }
        if line.trim() == END {
            in_section = false;
            continue;
        }
        if !in_section {
            kept.push(line);
        }
    }

    let mut new_content = kept.join("\r\n").trim_end().to_string();
    let mut unique: Vec<&String> = domains.iter().collect();
    unique.sort();
    unique.dedup();
    if !unique.is_empty() {
        new_content.push_str("\r\n");
        new_content.push_str(BEGIN);
        for d in unique {
            new_content.push_str(&format!("\r\n0.0.0.0 {d}\r\n0.0.0.0 www.{d}"));
        }
        new_content.push_str("\r\n");
        new_content.push_str(END);
    }
    new_content.push_str("\r\n");

    if new_content == current {
        None
    } else {
        Some(new_content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> String {
        "# Copyright (c) 1993-2009 Microsoft Corp.\r\n127.0.0.1 mypc.local\r\n".to_string()
    }

    #[test]
    fn adds_section_with_www_twin() {
        let out = rewrite(&base(), &["youtube.com".into()]).unwrap();
        assert!(out.contains("0.0.0.0 youtube.com"));
        assert!(out.contains("0.0.0.0 www.youtube.com"));
        assert!(out.starts_with("# Copyright"));
        assert!(out.contains("127.0.0.1 mypc.local"));
    }

    #[test]
    fn applying_same_domains_twice_is_a_noop() {
        let once = rewrite(&base(), &["youtube.com".into(), "x.com".into()]).unwrap();
        assert!(rewrite(&once, &["youtube.com".into(), "x.com".into()]).is_none());
    }

    #[test]
    fn empty_domains_removes_the_section() {
        let blocked = rewrite(&base(), &["reddit.com".into()]).unwrap();
        let cleared = rewrite(&blocked, &[]).unwrap();
        assert!(!cleared.contains("reddit.com"));
        assert!(!cleared.contains(BEGIN));
        assert!(cleared.contains("127.0.0.1 mypc.local"));
    }

    #[test]
    fn clearing_an_untouched_file_is_a_noop() {
        assert!(rewrite(&base(), &[]).is_none());
    }

    #[test]
    fn duplicate_domains_collapse() {
        let out = rewrite(&base(), &["x.com".into(), "x.com".into()]).unwrap();
        assert_eq!(out.matches("0.0.0.0 x.com").count(), 1);
    }
}
