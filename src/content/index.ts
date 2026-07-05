console.log("Media Downloader Pro: Content script loaded.");

// ============================================================
// TYPES
// ============================================================

export type MediaType = 'image' | 'video' | 'audio' | 'document';

export interface MediaVariant {
  url: string;
  width?: number;
  label: string;
}

export interface MediaItem {
  id: string;
  type: MediaType;
  thumbnail: string;
  title?: string;
  variants: MediaVariant[];
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function abs(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return null;
  }
}

function isHttp(url: string | null): url is string {
  return !!url && (url.startsWith('http://') || url.startsWith('https://'));
}

function parseSrcset(srcset: string): { url: string; width?: number }[] {
  const result: { url: string; width?: number }[] = [];
  if (!srcset) return result;
  for (const part of srcset.split(',')) {
    const tokens = part.trim().split(/\s+/);
    if (!tokens[0]) continue;
    const url = abs(tokens[0]);
    if (!isHttp(url)) continue;
    let width: number | undefined;
    if (tokens[1]?.endsWith('w')) {
      width = parseInt(tokens[1], 10);
      if (isNaN(width)) width = undefined;
    }
    result.push({ url, width });
  }
  return result;
}

function getFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const seg = pathname.split('/').pop() || '';
    return decodeURIComponent(seg.split('?')[0]);
  } catch {
    return '';
  }
}

function getExt(url: string): string {
  try {
    const pathname = new URL(url).pathname.split('?')[0];
    const dot = pathname.lastIndexOf('.');
    return dot >= 0 ? pathname.substring(dot).toLowerCase() : '';
  } catch {
    return '';
  }
}

const VIDEO_EXT = new Set(['.mp4', '.webm', '.ogg', '.ogv', '.avi', '.mov', '.mkv', '.m4v', '.flv', '.3gp']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.aac', '.oga', '.m4a', '.wma', '.opus']);
const DOC_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.zip', '.txt', '.ppt', '.pptx', '.rar', '.7z']);

// ============================================================
// MEDIA SCANNER (called by popup via message)
// ============================================================

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action !== "SCAN_MEDIA") return false;

  const items: MediaItem[] = [];
  const seenUrls = new Set<string>();
  let id = 0;

  function addItem(type: MediaType, url: string, thumb: string, title?: string, variants?: MediaVariant[]) {
    if (seenUrls.has(url)) return;
    seenUrls.add(url);
    items.push({
      id: `m_${id++}`,
      type,
      thumbnail: thumb,
      title,
      variants: variants || [{ url, label: type === 'image' ? 'Original' : type === 'video' ? 'Vidéo' : type === 'audio' ? 'Audio' : 'Fichier' }],
    });
  }

  // --- 1. Images ---
  document.querySelectorAll('img').forEach((img) => {
    const src = abs((img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src);
    if (!isHttp(src)) return;

    const rawVariants: { url: string; width?: number }[] = [{ url: src }];
    if ((img as HTMLImageElement).srcset) rawVariants.push(...parseSrcset((img as HTMLImageElement).srcset));
    const picture = img.closest('picture');
    if (picture) {
      picture.querySelectorAll('source').forEach(s => {
        if (s.srcset) rawVariants.push(...parseSrcset(s.srcset));
      });
    }

    // Deduplicate variants
    const map = new Map<string, { url: string; width?: number }>();
    rawVariants.forEach(v => { if (!map.has(v.url)) map.set(v.url, v); });
    const variants = Array.from(map.values())
      .sort((a, b) => (b.width || 0) - (a.width || 0))
      .map((v, i, arr) => ({
        url: v.url,
        width: v.width,
        label: v.width ? `${v.width}w${i === 0 && arr.length > 1 ? ' (Max)' : ''}` : (arr.length > 1 && i === arr.length - 1 ? 'Base' : 'Original'),
      }));

    if (!seenUrls.has(src)) {
      seenUrls.add(src);
      items.push({ id: `m_${id++}`, type: 'image', thumbnail: src, variants });
    }
  });

  // --- 2. CSS background-images ---
  document.querySelectorAll('div, section, article, header, figure, span, a').forEach(el => {
    try {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none') return;
      const m = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
      if (!m) return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 60 && rect.height > 60) {
        addItem('image', m[1], m[1]);
      }
    } catch { /* skip */ }
  });

  // --- 3. Videos ---
  document.querySelectorAll('video').forEach((video) => {
    const v = video as HTMLVideoElement;
    const poster = abs(v.poster) || '';
    const sources: string[] = [];

    // Direct src
    const vSrc = v.currentSrc || v.src;
    if (vSrc && !vSrc.startsWith('blob:') && isHttp(abs(vSrc))) sources.push(abs(vSrc)!);
    // <source> children
    v.querySelectorAll('source').forEach(s => {
      const u = abs(s.src || s.getAttribute('src'));
      if (u && !u.startsWith('blob:') && isHttp(u) && !sources.includes(u)) sources.push(u);
    });

    if (sources.length > 0) {
      const variants = sources.map((s, i) => ({ url: s, label: sources.length > 1 ? `Source ${i + 1}` : 'Vidéo' }));
      addItem('video', sources[0], poster, getFilename(sources[0]) || undefined, variants);
    }
  });

  // --- 4. Audio ---
  document.querySelectorAll('audio').forEach((audio) => {
    const a = audio as HTMLAudioElement;
    const sources: string[] = [];
    const aSrc = a.currentSrc || a.src;
    if (aSrc && !aSrc.startsWith('blob:') && isHttp(abs(aSrc))) sources.push(abs(aSrc)!);
    a.querySelectorAll('source').forEach(s => {
      const u = abs(s.src || s.getAttribute('src'));
      if (u && !u.startsWith('blob:') && isHttp(u) && !sources.includes(u)) sources.push(u);
    });
    if (sources.length > 0) {
      const variants = sources.map((s, i) => ({ url: s, label: sources.length > 1 ? `Source ${i + 1}` : 'Audio' }));
      addItem('audio', sources[0], '', getFilename(sources[0]) || undefined, variants);
    }
  });

  // --- 5. Links (<a href>) to media files ---
  document.querySelectorAll('a[href]').forEach(el => {
    const href = (el as HTMLAnchorElement).href;
    const url = abs(href);
    if (!isHttp(url)) return;
    const ext = getExt(url);
    if (!ext) return;

    const title = (el as HTMLAnchorElement).textContent?.trim() || getFilename(url) || '';

    if (VIDEO_EXT.has(ext)) addItem('video', url, '', title);
    else if (AUDIO_EXT.has(ext)) addItem('audio', url, '', title);
    else if (DOC_EXT.has(ext)) addItem('document', url, '', title);
  });

  // --- 6. Embedded media (embed, object, iframe) ---
  document.querySelectorAll('embed[src], object[data], iframe[src]').forEach(el => {
    const src = abs(el.getAttribute('src') || el.getAttribute('data'));
    if (!isHttp(src)) return;
    const ext = getExt(src);
    if (VIDEO_EXT.has(ext)) addItem('video', src, '', getFilename(src));
    else if (AUDIO_EXT.has(ext)) addItem('audio', src, '', getFilename(src));
    else if (ext === '.pdf') addItem('document', src, '', getFilename(src) || 'PDF');
  });

  // --- 7. data-src, data-video-src and other common data attributes ---
  const dataAttrs = ['data-src', 'data-video-src', 'data-audio-src', 'data-url', 'data-href', 'data-mp4', 'data-webm'];
  document.querySelectorAll('[data-src], [data-video-src], [data-audio-src], [data-url], [data-href], [data-mp4], [data-webm]').forEach(el => {
    for (const attr of dataAttrs) {
      const val = el.getAttribute(attr);
      const url = abs(val);
      if (!isHttp(url)) continue;
      const ext = getExt(url);
      if (VIDEO_EXT.has(ext)) addItem('video', url, '', getFilename(url));
      else if (AUDIO_EXT.has(ext)) addItem('audio', url, '', getFilename(url));
      else if (DOC_EXT.has(ext)) addItem('document', url, '', getFilename(url));
      else {
        const imgExt = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.bmp']);
        if (imgExt.has(ext)) addItem('image', url, url);
      }
    }
  });

  // --- 8. Performance API: scan all resources already loaded by the browser ---
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (const entry of entries) {
      const url = entry.name;
      if (!isHttp(url)) continue;
      if (url.startsWith('chrome-extension://')) continue;

      const ext = getExt(url);
      const initiatorType = entry.initiatorType;

      if (initiatorType === 'video' || VIDEO_EXT.has(ext)) {
        addItem('video', url, '', getFilename(url));
      } else if (initiatorType === 'audio' || AUDIO_EXT.has(ext)) {
        addItem('audio', url, '', getFilename(url));
      } else if (DOC_EXT.has(ext)) {
        addItem('document', url, '', getFilename(url));
      }
    }
  } catch (e) {
    console.warn("MDP: Performance API scan failed:", e);
  }

  console.log(`MDP: Detected ${items.length} media items (DOM + Performance).`);
  sendResponse({ images: items });
  return true;
});


// ============================================================
// ON-PAGE FLOATING "MDP" DOWNLOAD BUTTON
// ============================================================

let activeMediaUrl = "";

/**
 * Walk up DOM to find any element that has downloadable media.
 * Supports: <img>, <video>, <audio>, <a href="file.pdf">, <embed>, <object>, <iframe>, [data-src]
 */
function findDownloadable(el: HTMLElement | null): { element: HTMLElement; url: string } | null {
  let cur = el;
  for (let depth = 0; depth < 8 && cur; depth++) {
    const tag = cur.tagName;

    // --- Video elements ---
    if (tag === 'VIDEO') {
      const v = cur as HTMLVideoElement;
      
      if (v.currentSrc && !v.currentSrc.startsWith('blob:') && isHttp(v.currentSrc)) return { element: cur, url: v.currentSrc };
      if (v.src && !v.src.startsWith('blob:') && isHttp(v.src)) return { element: cur, url: v.src };
      
      for (const s of v.querySelectorAll('source')) {
        const u = s.src || s.getAttribute('src');
        if (u && !u.startsWith('blob:') && isHttp(u)) return { element: cur, url: u };
      }
      
      // If it's a blob: URL (like streaming sites), we intercept from network
      if ((v.currentSrc && v.currentSrc.startsWith('blob:')) || (v.src && v.src.startsWith('blob:'))) {
        return { element: cur, url: 'BLOB_VIDEO_STREAM' };
      }
      
      // Fallback: If we don't know the src but it's a video tag, try to download best network video
      return { element: cur, url: 'BLOB_VIDEO_STREAM' };
    }

    // --- Links to video files ---
    if (tag === 'A') {
      const href = (cur as HTMLAnchorElement).href;
      const url = abs(href);
      if (url && isHttp(url) && VIDEO_EXT.has(getExt(url))) return { element: cur, url };
    }

    // --- Embedded videos ---
    if (tag === 'EMBED' || tag === 'OBJECT' || tag === 'IFRAME') {
      const src = abs(cur.getAttribute('src') || cur.getAttribute('data'));
      if (src && isHttp(src)) {
        if (VIDEO_EXT.has(getExt(src)) || src.includes('youtube.com/embed') || src.includes('vimeo.com/video') || src.includes('dailymotion.com/video')) {
          return { element: cur, url: src };
        }
      }
    }

    // --- data-src video attributes ---
    const dataAttrs = ['data-src', 'data-video-src', 'data-url', 'data-mp4', 'data-webm'];
    for (const attr of dataAttrs) {
      const val = cur.getAttribute(attr);
      const url = abs(val);
      if (url && isHttp(url) && VIDEO_EXT.has(getExt(url))) return { element: cur, url };
    }

    // --- Check for direct video children ---
    const child = cur.querySelector(':scope > video') as HTMLElement | null;
    if (child) {
      const rect = child.getBoundingClientRect();
      if (rect.width > 30 && rect.height > 30) {
        const result = findDownloadable(child);
        if (result) return result;
      }
    }

    cur = cur.parentElement;
  }
  return null;
}

// -- Build the floating button --
const mdpBtn = document.createElement("div");
mdpBtn.id = "mdp-quick-dl";

const STYLE = [
  "position:fixed",
  "z-index:2147483647",
  "display:none",
  "align-items:center",
  "gap:7px",
  "background:linear-gradient(135deg,#007AFF 0%,#0055D4 100%)",
  "color:#fff",
  "border:2px solid rgba(255,255,255,0.45)",
  "border-radius:12px",
  "padding:10px 16px",
  "cursor:pointer",
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
  "font-size:13px",
  "font-weight:800",
  "letter-spacing:0.4px",
  "box-shadow:0 4px 24px rgba(0,122,255,0.55),0 0 0 1px rgba(0,122,255,0.3),inset 0 1px 0 rgba(255,255,255,0.15)",
  "pointer-events:auto",
  "user-select:none",
  "text-shadow:0 1px 2px rgba(0,0,0,0.25)",
  "line-height:1",
  "white-space:nowrap",
  "transition:transform 0.12s ease",
  "margin:0",
  "opacity:1",
  "visibility:visible",
].map(s => s + " !important").join(";");

const DL_ICON = '<svg style="flex-shrink:0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const OK_ICON = '<svg style="flex-shrink:0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const BTN_LABEL = '<span style="color:#fff!important;font-weight:800!important;font-size:13px!important;font-family:inherit!important">⬇ MDP</span>';

function resetBtn() {
  mdpBtn.setAttribute("style", STYLE);
  mdpBtn.innerHTML = DL_ICON + BTN_LABEL;
}
resetBtn();

// Append to <html>
document.documentElement.appendChild(mdpBtn);

// -- Download handler --
function triggerDownload(url: string) {
  if (url === 'BLOB_VIDEO_STREAM') {
    console.log("MDP: Blob video detected, asking background for best network video...");
    try {
      chrome.runtime.sendMessage({ action: "DOWNLOAD_BEST_VIDEO" }, (resp) => {
        if (chrome.runtime.lastError || (resp && resp.error)) {
          console.warn("MDP: Failed to download best video via network intercept:", chrome.runtime.lastError?.message || resp?.error);
          alert("Désolé, aucune vidéo n'a encore été capturée sur le réseau pour cette page. Laissez la vidéo jouer quelques secondes et réessayez.");
        }
      });
    } catch (err) {
      console.error("MDP: runtime error", err);
    }
    return;
  }

  const downloadUrl = url;
  console.log("MDP: Requesting download for:", downloadUrl);

  try {
    chrome.runtime.sendMessage({ action: "DOWNLOAD", urls: [downloadUrl] }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn("MDP: sendMessage failed, trying fallback:", chrome.runtime.lastError.message);
        try {
          chrome.runtime.sendMessage({ action: "DOWNLOAD_VIA_TAB", url: downloadUrl });
        } catch {
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = getFilename(downloadUrl) || 'download';
          a.target = '_blank';
          a.rel = 'noopener';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => a.remove(), 100);
        }
        return;
      }
      if (resp && resp.failed && resp.failed > 0) {
        console.warn("MDP: Some downloads failed via API, trying tab fallback");
        chrome.runtime.sendMessage({ action: "DOWNLOAD_VIA_TAB", url: downloadUrl });
      }
    });
  } catch (err) {
    console.error("MDP: runtime error, last resort download:", err);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = getFilename(downloadUrl) || 'download';
    a.target = '_blank';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 100);
  }
}

// -- Mouse event: click on the MDP button --
mdpBtn.addEventListener("mousedown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  if (!activeMediaUrl) return;

  triggerDownload(activeMediaUrl);

  // Visual feedback: green success
  const currentTop = mdpBtn.style.top;
  const currentLeft = mdpBtn.style.left;
  mdpBtn.setAttribute("style",
    STYLE
      .replace(/background:[^!]+!important/, "background:linear-gradient(135deg,#34C759 0%,#248A3D 100%) !important")
      .replace(/box-shadow:[^!]+!important/, "box-shadow:0 4px 24px rgba(52,199,89,0.6),0 2px 8px rgba(0,0,0,0.2) !important")
      .replace("display:none", "display:flex")
  );
  mdpBtn.style.top = currentTop;
  mdpBtn.style.left = currentLeft;
  mdpBtn.innerHTML = OK_ICON + '<span style="color:#fff!important;font-weight:800!important;font-size:13px!important;font-family:inherit!important">✓ Téléchargé !</span>';

  setTimeout(() => {
    mdpBtn.style.display = "none";
    setTimeout(resetBtn, 200);
  }, 1200);
}, true);

// Block click propagation
mdpBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}, true);

// -- Hover logic --
let hideTimer: number | undefined;

function showBtn(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  // For links/documents, allow smaller elements (text links)
  const minSize = (el.tagName === 'A' || el.tagName === 'EMBED' || el.tagName === 'OBJECT') ? 20 : 50;
  if (rect.width < minSize || rect.height < minSize) return;

  clearTimeout(hideTimer);
  mdpBtn.style.display = "flex";

  // Position top-right of the element
  let top = rect.top + 8;
  let left = rect.right - 140;
  // For small elements (text links), position to the right instead
  if (rect.width < 140) {
    left = rect.right + 8;
  }
  if (top < 4) top = 4;
  if (left < 4) left = 4;
  if (top > window.innerHeight - 50) top = window.innerHeight - 50;
  if (left > window.innerWidth - 150) left = window.innerWidth - 150;

  mdpBtn.style.top = top + "px";
  mdpBtn.style.left = left + "px";
}

document.addEventListener("mouseover", (e) => {
  const target = e.target as HTMLElement;

  // Ignore our own button
  if (target === mdpBtn || mdpBtn.contains(target)) {
    clearTimeout(hideTimer);
    return;
  }

  // Find any downloadable media (images, videos, audios, doc links, embeds...)
  const result = findDownloadable(target);
  if (result) {
    activeMediaUrl = result.url;
    showBtn(result.element);
  } else {
    hideTimer = window.setTimeout(() => { mdpBtn.style.display = "none"; }, 400);
  }
}, true);

mdpBtn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
mdpBtn.addEventListener("mouseleave", () => {
  hideTimer = window.setTimeout(() => { mdpBtn.style.display = "none"; }, 400);
});
