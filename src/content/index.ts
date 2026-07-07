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

function getExt(url: string | null): string {
  if (!url) return '';
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

    const vSrc = v.currentSrc || v.src;
    if (vSrc && !vSrc.startsWith('blob:') && isHttp(abs(vSrc))) sources.push(abs(vSrc)!);
    v.querySelectorAll('source').forEach(s => {
      const u = abs(s.src || s.getAttribute('src'));
      if (u && !u.startsWith('blob:') && isHttp(u) && !sources.includes(u)) sources.push(u);
    });

    if (sources.length > 0) {
      const variants = sources.map((s, i) => ({ url: s, label: sources.length > 1 ? `Source ${i + 1}` : 'Vidéo' }));
      addItem('video', sources[0], poster, getFilename(sources[0]) || undefined, variants);
    } else if (vSrc && vSrc.startsWith('blob:')) {
      addItem('video', 'BLOB_VIDEO', poster, 'Vidéo Protégée (Blob)', [{ url: 'BLOB_VIDEO', label: 'Détecter la source' }]);
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

  // --- 6. Embedded media ---
  document.querySelectorAll('embed[src], object[data], iframe[src]').forEach(el => {
    const src = abs(el.getAttribute('src') || el.getAttribute('data'));
    if (!isHttp(src)) return;
    const ext = getExt(src);
    if (VIDEO_EXT.has(ext)) addItem('video', src, '', getFilename(src));
    else if (AUDIO_EXT.has(ext)) addItem('audio', src, '', getFilename(src));
    else if (ext === '.pdf') addItem('document', src, '', getFilename(src) || 'PDF');
  });

  // --- 7. data-src attributes ---
  const dataAttrNames = ['data-src', 'data-video-src', 'data-audio-src', 'data-url', 'data-href', 'data-mp4', 'data-webm'];
  document.querySelectorAll('[data-src], [data-video-src], [data-audio-src], [data-url], [data-href], [data-mp4], [data-webm]').forEach(el => {
    for (const attr of dataAttrNames) {
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

  // --- 8. Performance API ---
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (const entry of entries) {
      const url = entry.name;
      if (!isHttp(url) || url.startsWith('chrome-extension://')) continue;
      const ext = getExt(url);
      const it = entry.initiatorType;
      if (it === 'video' || VIDEO_EXT.has(ext)) addItem('video', url, '', getFilename(url));
      else if (it === 'audio' || AUDIO_EXT.has(ext)) addItem('audio', url, '', getFilename(url));
      else if (DOC_EXT.has(ext)) addItem('document', url, '', getFilename(url));
    }
  } catch (e) {
    console.warn("MDP: Performance API scan failed:", e);
  }

  console.log(`MDP: Detected ${items.length} media items.`);
  sendResponse({ images: items });
  return true;
});


// ============================================================
// ON-PAGE FLOATING "MDP" DOWNLOAD BUTTON (VIDEO ONLY)
// ============================================================

let capturedUrl = "";  // The URL captured at mousedown time

/**
 * Extract a downloadable video URL from a <video> element.
 * Returns a direct HTTP URL or null.
 */
function getVideoUrl(video: HTMLVideoElement): string | null {
  // 1. Try currentSrc (the actually playing source)
  const cur = video.currentSrc;
  if (cur && isHttp(cur) && !cur.startsWith('blob:')) return cur;

  // 2. Try src attribute
  const src = video.getAttribute('src');
  const absSrc = abs(src);
  if (absSrc && isHttp(absSrc) && !absSrc.startsWith('blob:')) return absSrc;

  // 3. Try <source> children
  const sources = video.querySelectorAll('source');
  for (const s of sources) {
    const u = abs(s.getAttribute('src'));
    if (u && isHttp(u) && !u.startsWith('blob:')) return u;
  }

  return null;
}

/**
 * Find a <video> element at or near the target element.
 * Searches:
 * 1. The element itself (if it's a video)
 * 2. Direct video descendants
 * 3. Parent elements up to 6 levels, including their video descendants
 */
function findVideoElement(target: HTMLElement): HTMLVideoElement | null {
  // Is it a video?
  if (target.tagName === 'VIDEO') return target as HTMLVideoElement;

  // Does it contain a video?
  const childVideo = target.querySelector('video') as HTMLVideoElement | null;
  if (childVideo) return childVideo;

  // Walk up parents and check for videos
  let parent = target.parentElement;
  for (let i = 0; i < 6 && parent; i++) {
    if (parent.tagName === 'VIDEO') return parent as HTMLVideoElement;

    const vid = parent.querySelector('video') as HTMLVideoElement | null;
    if (vid) {
      // Verify it's a "real" video (not a tiny thumbnail)
      const rect = vid.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 30) return vid;
    }
    parent = parent.parentElement;
  }

  return null;
}

// -- Build the floating button using Shadow DOM for style isolation --
const host = document.createElement('div');
host.id = 'mdp-host';
host.style.cssText = 'all:initial !important; position:fixed !important; z-index:2147483647 !important; pointer-events:none !important; top:0 !important; left:0 !important; width:0 !important; height:0 !important;';
document.documentElement.appendChild(host);

const shadow = host.attachShadow({ mode: 'closed' });

const btnContainer = document.createElement('div');
btnContainer.innerHTML = `
  <style>
    #mdp-btn {
      position: fixed;
      z-index: 2147483647;
      display: none;
      align-items: center;
      gap: 7px;
      background: linear-gradient(135deg, #FF3B30 0%, #C0392B 100%);
      color: #fff;
      border: 2px solid rgba(255,255,255,0.5);
      border-radius: 12px;
      padding: 10px 16px;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.5px;
      box-shadow: 0 4px 20px rgba(255,59,48,0.6), 0 0 0 1px rgba(255,59,48,0.3);
      pointer-events: auto;
      user-select: none;
      text-shadow: 0 1px 2px rgba(0,0,0,0.3);
      line-height: 1;
      white-space: nowrap;
      transition: transform 0.15s ease, background 0.3s ease;
    }
    #mdp-btn:hover {
      transform: scale(1.08);
      background: linear-gradient(135deg, #FF6B6B 0%, #FF3B30 100%);
    }
    #mdp-btn:active {
      transform: scale(0.95);
    }
    #mdp-btn.success {
      background: linear-gradient(135deg, #34C759 0%, #248A3D 100%);
      box-shadow: 0 4px 20px rgba(52,199,89,0.6), 0 0 0 1px rgba(52,199,89,0.3);
    }
    #mdp-btn svg {
      flex-shrink: 0;
    }
  </style>
  <div id="mdp-btn">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    <span>⬇ MDP</span>
  </div>
`;
shadow.appendChild(btnContainer);

const mdpBtn = shadow.getElementById('mdp-btn') as HTMLDivElement;

const DL_HTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>⬇ MDP</span>`;
const OK_HTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>✓ Téléchargé !</span>`;

function resetBtn() {
  mdpBtn.innerHTML = DL_HTML;
  mdpBtn.classList.remove('success');
}
resetBtn();

// -- Download handler --
function triggerDownload(url: string) {
  console.log("MDP: triggerDownload called with:", url);

  if (!url) {
    console.warn("MDP: No URL to download");
    return;
  }

  try {
    chrome.runtime.sendMessage(
      { action: "DOWNLOAD", urls: [url] },
      (resp) => {
        if (chrome.runtime.lastError) {
          console.warn("MDP: sendMessage error:", chrome.runtime.lastError.message);
          // Fallback: try opening in a new tab
          try {
            chrome.runtime.sendMessage({ action: "DOWNLOAD_VIA_TAB", url });
          } catch {
            // Last resort: use <a> tag
            const a = document.createElement('a');
            a.href = url;
            a.download = getFilename(url) || 'video';
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 200);
          }
          return;
        }
        console.log("MDP: Download response:", resp);
        if (resp && resp.failed && resp.failed > 0) {
          // Fallback
          chrome.runtime.sendMessage({ action: "DOWNLOAD_VIA_TAB", url });
        }
      }
    );
  } catch (err) {
    console.error("MDP: runtime.sendMessage threw:", err);
    // Last resort
    const a = document.createElement('a');
    a.href = url;
    a.download = getFilename(url) || 'video';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 200);
  }
}

// -- MDP Button click handler --
mdpBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const url = capturedUrl;
  console.log("MDP: Button clicked, url =", url);
  if (!url) return;

  // If the video is a blob stream, ask background for network-intercepted video
  if (url === 'BLOB_VIDEO') {
    console.log("MDP: Blob video, asking background for network video...");
    try {
      chrome.runtime.sendMessage({ action: "DOWNLOAD_BEST_VIDEO" }, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn("MDP: DOWNLOAD_BEST_VIDEO failed:", chrome.runtime.lastError.message);
          return;
        }
        if (resp && resp.error) {
          console.warn("MDP: No network video found:", resp.error);
          
          // Show visual error instead of alert()
          const errorMsg = document.createElement('div');
          errorMsg.textContent = `MDP: Impossible de télécharger (Flux protégé). Laissez la vidéo jouer un peu.`;
          errorMsg.style.cssText = 'position:fixed; z-index:2147483647; top:20px; right:20px; background:#FF3B30; color:white; padding:12px 16px; border-radius:8px; font-family:sans-serif; font-size:14px; font-weight:bold; box-shadow:0 4px 12px rgba(0,0,0,0.3);';
          document.body.appendChild(errorMsg);
          setTimeout(() => errorMsg.remove(), 4000);
          
          mdpBtn.innerHTML = DL_HTML;
          mdpBtn.classList.remove('success');
        } else {
          console.log("MDP: Network video download started");
        }
      });
    } catch (err) {
      console.error("MDP: Error:", err);
    }
  } else {
    // Direct video URL - download it
    triggerDownload(url);
  }

  // Visual feedback
  mdpBtn.innerHTML = OK_HTML;
  mdpBtn.classList.add('success');

  setTimeout(() => {
    mdpBtn.style.display = 'none';
    resetBtn();
  }, 1500);
}, true);

// Prevent mousedown from bubbling to the page (avoids pausing video etc.)
mdpBtn.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  e.stopImmediatePropagation();
}, true);

// -- Hover logic --
let hideTimer: number | undefined;

function showBtnAt(rect: DOMRect) {
  if (rect.width < 50 || rect.height < 30) return;

  clearTimeout(hideTimer);
  mdpBtn.style.display = 'flex';

  // Position at top-right of the video
  let top = rect.top + 10;
  let left = rect.right - 150;

  // Clamp to viewport
  if (top < 4) top = 4;
  if (left < 4) left = 4;
  if (top > window.innerHeight - 50) top = window.innerHeight - 50;
  if (left > window.innerWidth - 160) left = window.innerWidth - 160;

  mdpBtn.style.top = top + 'px';
  mdpBtn.style.left = left + 'px';
}

document.addEventListener('mouseover', (e) => {
  const target = e.target as HTMLElement;

  // Ignore our own host element
  if (target === host || host.contains(target)) {
    clearTimeout(hideTimer);
    return;
  }

  // Try to find a video element
  const video = findVideoElement(target);
  if (video) {
    const url = getVideoUrl(video);
    if (url) {
      capturedUrl = url;
    } else {
      // It's a blob/streaming video
      capturedUrl = 'BLOB_VIDEO';
    }
    showBtnAt(video.getBoundingClientRect());
  } else {
    hideTimer = window.setTimeout(() => {
      mdpBtn.style.display = 'none';
    }, 500);
  }
}, true);

// Keep button visible when hovering over it
host.addEventListener('mouseenter', () => clearTimeout(hideTimer));
host.addEventListener('mouseleave', () => {
  hideTimer = window.setTimeout(() => {
    mdpBtn.style.display = 'none';
  }, 500);
});

// Also listen on shadow root events
mdpBtn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
mdpBtn.addEventListener('mouseleave', () => {
  hideTimer = window.setTimeout(() => {
    mdpBtn.style.display = 'none';
  }, 500);
});
