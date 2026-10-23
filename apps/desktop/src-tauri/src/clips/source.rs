/// Validate suitability without normalizing the identity. The caller stores and
/// compares the original URL, including its spelling, query and fragment.
pub(super) fn auto_source_key(raw: Option<&str>) -> Option<&str> {
    let raw = raw?;
    if raw.chars().any(|c| c.is_whitespace() || c.is_control()) || raw.contains('\\') {
        return None;
    }
    let (scheme, remainder) = raw.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return None;
    }
    let authority = remainder.split(['/', '?', '#']).next()?;
    if authority.contains('@') {
        return None;
    }
    let parsed = url::Url::parse(raw).ok()?;
    // An origin alone cannot reliably identify a document or conversation.
    // Queries and fragments do not relax this conservative landing-page rule.
    if parsed.path() == "/" {
        return None;
    }
    let host = parsed.host_str()?;
    // URL parsing accepts some reg-name spellings that are not reliable DNS
    // hostnames. Be conservative; IPv4 and IPv6 are already validated by Url.
    let host = host.strip_suffix('.').unwrap_or(host);
    if matches!(parsed.host(), Some(url::Host::Domain(_)))
        && (host.len() > 253
            || host.split('.').any(|label| {
                label.is_empty()
                    || label.len() > 63
                    || label.starts_with('-')
                    || label.ends_with('-')
                    || !label
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            }))
    {
        return None;
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return None;
    }
    let path: Vec<_> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    let identified = |route: &str| {
        path.windows(2)
            .any(|pair| pair[0] == route && !matches!(pair[1], "new" | "new-chat"))
    };
    // Match the provider families recognized by extension capture. Hostname
    // classification is only suitability validation; raw identities stay exact.
    let in_family = |domain: &str| {
        host == domain
            || host
                .strip_suffix(domain)
                .is_some_and(|prefix| prefix.ends_with('.'))
    };
    let suitable = if in_family("chatgpt.com") || host == "chat.openai.com" {
        identified("c") || identified("share")
    } else if in_family("claude.ai") {
        identified("chat") || identified("share")
    } else if in_family("gemini.google.com") {
        identified("app") || identified("share")
    } else {
        true
    };
    suitable.then_some(raw)
}
