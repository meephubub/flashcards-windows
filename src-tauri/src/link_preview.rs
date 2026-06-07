use serde::Serialize;
use url::Url;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
}

pub fn normalize_http_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("URL is required".to_string());
    }

    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    let parsed = Url::parse(&with_scheme).map_err(|e| e.to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed.to_string()),
        _ => Err("Only http and https links are supported".to_string()),
    }
}

pub async fn fetch_link_preview(client: &reqwest::Client, url: &str) -> Result<LinkPreview, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Could not reach site: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Site returned {}", response.status()));
    }

    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !content_type.contains("text/html") && !content_type.is_empty() {
        return Ok(fallback_preview(&final_url, None));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let capped = bytes.iter().take(512_000).copied().collect::<Vec<_>>();
    let html = String::from_utf8_lossy(&capped).into_owned();

    Ok(parse_html_preview(&final_url, &html))
}

pub fn fallback_preview(url: &str, title: Option<String>) -> LinkPreview {
    LinkPreview {
        url: url.to_string(),
        title,
        description: None,
        image_url: None,
        site_name: host_label(url),
    }
}

pub fn parse_html_preview(page_url: &str, html: &str) -> LinkPreview {
    let title = extract_meta(html, "og:title", true)
        .or_else(|| extract_meta(html, "twitter:title", true))
        .or_else(|| extract_title_tag(html));

    let description = extract_meta(html, "og:description", true)
        .or_else(|| extract_meta(html, "description", false))
        .or_else(|| extract_meta(html, "twitter:description", true));

    let image_raw = extract_meta(html, "og:image", true)
        .or_else(|| extract_meta(html, "twitter:image", true))
        .or_else(|| extract_meta(html, "twitter:image:src", true));

    let image_url = image_raw.and_then(|raw| resolve_url(page_url, &raw));

    let site_name = extract_meta(html, "og:site_name", true).or_else(|| host_label(page_url));

    LinkPreview {
        url: page_url.to_string(),
        title,
        description,
        image_url,
        site_name,
    }
}

fn host_label(url: &str) -> Option<String> {
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()))
}

fn extract_title_tag(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title>")? + "<title>".len();
    let end = lower[start..].find("</title>")? + start;
    let raw = html.get(start..end)?;
    decode_entities(raw.trim())
}

fn extract_meta(html: &str, key: &str, use_property: bool) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let key_lc = key.to_ascii_lowercase();
    let attr = if use_property { "property" } else { "name" };

    for quote in ['"', '\''] {
        let needle = format!("{attr}={quote}{key_lc}{quote}");
        let mut search_from = 0;
        while let Some(rel) = lower[search_from..].find(&needle) {
            let tag_start = lower[..search_from + rel]
                .rfind("<meta")
                .unwrap_or(search_from + rel);
            let tag_end = lower[tag_start..]
                .find('>')
                .map(|i| tag_start + i)
                .unwrap_or(tag_start + 400);
            let tag = &html[tag_start..tag_end.min(html.len())];
            if let Some(value) = read_meta_content(tag) {
                return decode_entities(&value);
            }
            search_from = tag_end + 1;
            if search_from >= lower.len() {
                break;
            }
        }
    }

    None
}

fn read_meta_content(tag: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let idx = lower.find("content=")?;
    let rest = &tag[idx + "content=".len()..];
    let rest = rest.trim_start();
    let quote = rest.chars().next()?;
    if quote == '"' || quote == '\'' {
        let end = rest[1..].find(quote)? + 1;
        return Some(rest[1..end].to_string());
    }
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '>')
        .unwrap_or(rest.len());
    Some(rest[..end].to_string())
}

fn resolve_url(base: &str, value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Url::parse(base)
        .ok()?
        .join(trimmed)
        .ok()
        .map(|u| u.to_string())
}

fn decode_entities(input: &str) -> Option<String> {
    let decoded = input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");
    if decoded.is_empty() {
        None
    } else {
        Some(decoded)
    }
}
