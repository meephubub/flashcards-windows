export type MoodboardLinkData = {
  url: string;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
};

export type LinkPreviewResponse = {
  url: string;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
};

export function normalizeLinkInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function serializeLinkContent(data: MoodboardLinkData): string {
  return JSON.stringify({
    url: data.url,
    title: data.title ?? null,
    description: data.description ?? null,
    imageUrl: data.imageUrl ?? null,
    siteName: data.siteName ?? null,
  });
}

export function parseLinkContent(content: string): MoodboardLinkData {
  try {
    const parsed = JSON.parse(content) as MoodboardLinkData;
    if (parsed && typeof parsed.url === "string" && parsed.url.trim()) {
      return {
        url: parsed.url,
        title: parsed.title ?? null,
        description: parsed.description ?? null,
        imageUrl: parsed.imageUrl ?? null,
        siteName: parsed.siteName ?? null,
      };
    }
  } catch {
    /* legacy plain URL */
  }
  return { url: content.trim(), title: null, description: null, imageUrl: null, siteName: null };
}

export function linkHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function faviconUrl(url: string, size = 32): string {
  const host = linkHostname(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

export function previewFromResponse(response: LinkPreviewResponse): MoodboardLinkData {
  return {
    url: response.url,
    title: response.title ?? null,
    description: response.description ?? null,
    imageUrl: response.imageUrl ?? null,
    siteName: response.siteName ?? null,
  };
}

export function linkTileLabel(data: MoodboardLinkData): string {
  return data.title?.trim() || data.siteName?.trim() || linkHostname(data.url);
}
