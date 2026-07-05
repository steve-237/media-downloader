console.log("Media Downloader Pro: Content script injected!");

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

function parseSrcset(srcsetString: string): { url: string; width?: number }[] {
  const variants: { url: string; width?: number }[] = [];
  if (!srcsetString) return variants;

  const parts = srcsetString.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const segments = trimmed.split(/\s+/);
    const url = segments[0];
    let width: number | undefined;
    
    if (segments.length > 1) {
      const descriptor = segments[1];
      if (descriptor.endsWith('w')) {
        width = parseInt(descriptor.slice(0, -1), 10);
      }
    }
    
    try {
      const absoluteUrl = new URL(url, window.location.href).href;
      variants.push({ url: absoluteUrl, width: isNaN(width!) ? undefined : width });
    } catch (_e) {
      // invalid URL
    }
  }
  return variants;
}

function getAbsoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, window.location.href).href;
  } catch (_e) {
    return null;
  }
}

const videoExtensions = ['.mp4', '.webm', '.ogg', '.ogv', '.avi', '.mov', '.mkv', '.m4v', '.flv', '.3gp'];
const audioExtensions = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.oga', '.m4a', '.wma', '.opus'];
const documentExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.zip', '.txt', '.ppt', '.pptx', '.rar', '.7z'];

function getFileExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot === -1) return '';
    return pathname.substring(lastDot).toLowerCase();
  } catch {
    return '';
  }
}

function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/');
    return decodeURIComponent(segments[segments.length - 1] || '');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------
// Media Detection Engine (triggered by popup)
// ---------------------------------------------------------

chrome.runtime.onMessage.addListener((request: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (request.action === "SCAN_MEDIA") {
    const mediaItems: MediaItem[] = [];
    let idCounter = 0;

    // 1. Scan Images
    document.querySelectorAll('img').forEach((img: HTMLImageElement) => {
      const rawSrc = img.currentSrc || img.src;
      const absUrl = getAbsoluteUrl(rawSrc);
      if (!absUrl || !absUrl.startsWith('http')) return;

      let rawVariants: { url: string; width?: number }[] = [{ url: absUrl }];
      if (img.srcset) rawVariants.push(...parseSrcset(img.srcset));

      const parent = img.parentElement;
      if (parent && parent.tagName.toLowerCase() === 'picture') {
        parent.querySelectorAll('source').forEach(source => {
          if (source.srcset) rawVariants.push(...parseSrcset(source.srcset));
        });
      }

      const uniqueMap = new Map<string, { url: string; width?: number }>();
      rawVariants.forEach(v => {
        if (!uniqueMap.has(v.url)) uniqueMap.set(v.url, v);
        else if (!uniqueMap.get(v.url)?.width && v.width) uniqueMap.set(v.url, v);
      });

      const processedVariants = Array.from(uniqueMap.values())
        .sort((a, b) => (b.width || 0) - (a.width || 0))
        .map((v, index, arr) => {
          let label = "Original";
          if (v.width) {
            label = `${v.width}w`;
            if (index === 0 && arr.length > 1) label += " (Max)";
          } else if (arr.length > 1 && index === arr.length - 1) {
            label = "Base";
          }
          return { url: v.url, width: v.width, label };
        });

      mediaItems.push({ id: `media_${idCounter++}`, type: 'image', thumbnail: absUrl, variants: processedVariants });
    });

    // 2. Scan Videos
    document.querySelectorAll('video').forEach((video: HTMLVideoElement) => {
      const sources: string[] = [];
      if (video.src && !video.src.startsWith('blob:')) { const a = getAbsoluteUrl(video.src); if (a) sources.push(a); }
      if (video.currentSrc && !video.currentSrc.startsWith('blob:')) { const a = getAbsoluteUrl(video.currentSrc); if (a && !sources.includes(a)) sources.push(a); }
      video.querySelectorAll('source').forEach(s => {
        const src = s.src || s.getAttribute('src');
        if (src && !src.startsWith('blob:')) { const a = getAbsoluteUrl(src); if (a && !sources.includes(a)) sources.push(a); }
      });
      const poster = getAbsoluteUrl(video.poster) || '';
      if (sources.length > 0) {
        mediaItems.push({
          id: `media_${idCounter++}`, type: 'video', thumbnail: poster,
          title: getFilenameFromUrl(sources[0]) || undefined,
          variants: sources.map((s, i) => ({ url: s, label: sources.length > 1 ? `Source ${i + 1}` : "Vidéo" }))
        });
      }
    });

    // 3. Scan Audio
    document.querySelectorAll('audio').forEach((audio: HTMLAudioElement) => {
      const sources: string[] = [];
      if (audio.src && !audio.src.startsWith('blob:')) { const a = getAbsoluteUrl(audio.src); if (a) sources.push(a); }
      if (audio.currentSrc && !audio.currentSrc.startsWith('blob:')) { const a = getAbsoluteUrl(audio.currentSrc); if (a && !sources.includes(a)) sources.push(a); }
      audio.querySelectorAll('source').forEach(s => {
        const src = s.src || s.getAttribute('src');
        if (src && !src.startsWith('blob:')) { const a = getAbsoluteUrl(src); if (a && !sources.includes(a)) sources.push(a); }
      });
      if (sources.length > 0) {
        mediaItems.push({
          id: `media_${idCounter++}`, type: 'audio', thumbnail: '',
          title: getFilenameFromUrl(sources[0]) || undefined,
          variants: sources.map((s, i) => ({ url: s, label: sources.length > 1 ? `Source ${i + 1}` : "Audio" }))
        });
      }
    });

    // 4. Scan links for video/audio/document files
    document.querySelectorAll('a[href]').forEach((el: Element) => {
      const link = el as HTMLAnchorElement;
      const href = link.getAttribute('href');
      if (!href) return;
      const absUrl = getAbsoluteUrl(href);
      if (!absUrl || !absUrl.startsWith('http')) return;
      const ext = getFileExtension(absUrl);
      if (!ext) return;
      const filename = getFilenameFromUrl(absUrl) || link.textContent?.trim() || 'Fichier';

      if (videoExtensions.includes(ext)) {
        mediaItems.push({ id: `media_${idCounter++}`, type: 'video', thumbnail: '', title: filename, variants: [{ url: absUrl, label: `Vidéo (${ext.slice(1).toUpperCase()})` }] });
      } else if (audioExtensions.includes(ext)) {
        mediaItems.push({ id: `media_${idCounter++}`, type: 'audio', thumbnail: '', title: filename, variants: [{ url: absUrl, label: `Audio (${ext.slice(1).toUpperCase()})` }] });
      } else if (documentExtensions.includes(ext)) {
        mediaItems.push({ id: `media_${idCounter++}`, type: 'document', thumbnail: '', title: filename, variants: [{ url: absUrl, label: `Fichier (${ext.slice(1).toUpperCase()})` }] });
      }
    });

    // 5. Scan embed/object/iframe
    document.querySelectorAll('embed[src], object[data], iframe[src]').forEach(el => {
      const src = el.getAttribute('src') || el.getAttribute('data');
      if (!src || src.startsWith('blob:')) return;
      const absUrl = getAbsoluteUrl(src);
      if (!absUrl || !absUrl.startsWith('http')) return;
      const ext = getFileExtension(absUrl);
      if (videoExtensions.includes(ext)) {
        mediaItems.push({ id: `media_${idCounter++}`, type: 'video', thumbnail: '', title: getFilenameFromUrl(absUrl), variants: [{ url: absUrl, label: 'Vidéo intégrée' }] });
      } else if (audioExtensions.includes(ext)) {
        mediaItems.push({ id: `media_${idCounter++}`, type: 'audio', thumbnail: '', title: getFilenameFromUrl(absUrl), variants: [{ url: absUrl, label: 'Audio intégré' }] });
      } else if (ext === '.pdf') {
        mediaItems.push({ id: `media_${idCounter++}`, type: 'document', thumbnail: '', title: getFilenameFromUrl(absUrl) || 'PDF', variants: [{ url: absUrl, label: 'PDF intégré' }] });
      }
    });

    // 6. Scan CSS background-images
    document.querySelectorAll('*').forEach(el => {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        const match = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
        if (match?.[1]) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 80 && rect.height > 80) {
            mediaItems.push({ id: `media_${idCounter++}`, type: 'image', thumbnail: match[1], variants: [{ url: match[1], label: "Background Image" }] });
          }
        }
      }
    });

    // Deduplicate
    const seen = new Map<string, MediaItem>();
    mediaItems.forEach(item => {
      const key = item.variants[0]?.url || item.thumbnail;
      if (!seen.has(key)) seen.set(key, item);
    });

    const finalItems = Array.from(seen.values());
    console.log(`Media Downloader Pro: ${finalItems.length} media items detected.`);
    sendResponse({ images: finalItems });
  }
  return true;
});


// ==========================================================
// ON-PAGE FLOATING DOWNLOAD BUTTON
// ==========================================================

let activeMediaUrl = "";

/** Walk up to 6 levels to find img/video/audio (handles player overlays). */
function findMediaEl(el: HTMLElement | null): HTMLElement | null {
  let cur = el;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.tagName === 'IMG' || cur.tagName === 'VIDEO' || cur.tagName === 'AUDIO') return cur;
    const child = cur.querySelector(':scope > video, :scope > audio') as HTMLElement | null;
    if (child) return child;
    cur = cur.parentElement;
  }
  return null;
}

/** Extract a downloadable URL from the media element. */
function extractSrc(el: HTMLElement): string | null {
  if (el.tagName === 'IMG') {
    return (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || null;
  }
  if (el.tagName === 'VIDEO') {
    const v = el as HTMLVideoElement;
    if (v.currentSrc && !v.currentSrc.startsWith('blob:')) return v.currentSrc;
    if (v.src && !v.src.startsWith('blob:')) return v.src;
    for (const s of v.querySelectorAll('source')) {
      const u = s.src || s.getAttribute('src');
      if (u && !u.startsWith('blob:')) return u;
    }
    if (v.poster) return v.poster; // fallback: at least download the poster
    return null;
  }
  if (el.tagName === 'AUDIO') {
    const a = el as HTMLAudioElement;
    if (a.currentSrc && !a.currentSrc.startsWith('blob:')) return a.currentSrc;
    if (a.src && !a.src.startsWith('blob:')) return a.src;
    for (const s of a.querySelectorAll('source')) {
      const u = s.src || s.getAttribute('src');
      if (u && !u.startsWith('blob:')) return u;
    }
    return null;
  }
  return null;
}

// -- Build the button (plain DOM, no Shadow DOM, all !important to resist site CSS) --

const mdpBtn = document.createElement("div");
mdpBtn.id = "mdp-quick-download-btn";

const BASE_STYLE = `
  position: fixed !important;
  z-index: 2147483647 !important;
  display: none;
  align-items: center;
  gap: 7px;
  background: linear-gradient(135deg, #007AFF 0%, #0055D4 100%) !important;
  color: white !important;
  border: 2px solid rgba(255,255,255,0.45) !important;
  border-radius: 12px !important;
  padding: 10px 16px !important;
  cursor: pointer !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
  font-size: 13px !important;
  font-weight: 800 !important;
  letter-spacing: 0.4px !important;
  box-shadow: 0 4px 24px rgba(0,122,255,0.55), 0 0 0 1px rgba(0,122,255,0.3), inset 0 1px 0 rgba(255,255,255,0.15) !important;
  pointer-events: auto !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.25) !important;
  line-height: 1 !important;
  white-space: nowrap !important;
  transition: transform 0.12s ease, box-shadow 0.12s ease !important;
  margin: 0 !important;
  text-decoration: none !important;
  text-transform: none !important;
  opacity: 1 !important;
  visibility: visible !important;
  overflow: visible !important;
  text-align: left !important;
  min-width: 0 !important;
  max-width: none !important;
  min-height: 0 !important;
  max-height: none !important;
  width: auto !important;
  height: auto !important;
  float: none !important;
  top: 0; left: 0;
`.trim();

const DL_SVG = '<svg style="flex-shrink:0;display:inline-block" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const OK_SVG = '<svg style="flex-shrink:0;display:inline-block" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const LABEL = '<span style="color:white!important;font-weight:800!important;font-size:13px!important;line-height:1!important;font-family:inherit!important">⬇ MDP</span>';

function resetMdpBtn() {
  mdpBtn.setAttribute("style", BASE_STYLE);
  mdpBtn.innerHTML = DL_SVG + LABEL;
}
resetMdpBtn();
document.documentElement.appendChild(mdpBtn);

function fallbackDownload(url: string) {
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = getFilenameFromUrl(url) || 'download';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    console.error("MDP fallback download failed:", err);
  }
}

// -- Click handler: download the media --

mdpBtn.addEventListener("mousedown", function (e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  if (!activeMediaUrl) return;

  // Send download request
  try {
    chrome.runtime.sendMessage({ action: "DOWNLOAD", urls: [activeMediaUrl] }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("MDP: background script unreachable, using fallback.", chrome.runtime.lastError.message);
        fallbackDownload(activeMediaUrl);
      } else if (response && response.error) {
        console.warn("MDP: background download failed, using fallback.", response.error);
        fallbackDownload(activeMediaUrl);
      }
    });
  } catch (err) {
    console.warn("MDP: chrome.runtime.sendMessage error, using fallback:", err);
    fallbackDownload(activeMediaUrl);
  }

  // Visual success
  mdpBtn.setAttribute("style", BASE_STYLE
    .replace(/background:[^!]+!important/, "background: linear-gradient(135deg, #34C759 0%, #248A3D 100%) !important")
    .replace(/box-shadow:[^!]+!important/, "box-shadow: 0 4px 24px rgba(52,199,89,0.6), 0 2px 8px rgba(0,0,0,0.2) !important")
    .replace("display: none", "display: flex")
  );
  mdpBtn.style.top = mdpBtn.style.top; // keep position
  mdpBtn.style.left = mdpBtn.style.left;
  mdpBtn.innerHTML = OK_SVG + '<span style="color:white!important;font-weight:800!important;font-size:13px!important;line-height:1!important;font-family:inherit!important">✓ Téléchargé !</span>';
  mdpBtn.style.transform = "scale(1.08)";

  setTimeout(() => {
    mdpBtn.style.display = "none";
    setTimeout(resetMdpBtn, 300);
  }, 1000);
}, true);

mdpBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }, true);

// -- Hover logic --

let hideTimer: number | undefined;

function showMdpBtn(mediaEl: HTMLElement) {
  const rect = mediaEl.getBoundingClientRect();
  if (rect.width < 50 || rect.height < 50) return; // skip tiny icons

  clearTimeout(hideTimer);
  mdpBtn.style.display = "flex";

  let top = rect.top + 8;
  let left = rect.right - 140;
  // Clamp inside viewport
  if (top < 4) top = 4;
  if (left < 4) left = 4;
  if (top > window.innerHeight - 50) top = window.innerHeight - 50;
  if (left > window.innerWidth - 150) left = window.innerWidth - 150;

  mdpBtn.style.top = top + "px";
  mdpBtn.style.left = left + "px";
}

document.addEventListener("mouseover", (e) => {
  const target = e.target as HTMLElement;

  // Don't hide when hovering our own button
  if (target === mdpBtn || mdpBtn.contains(target)) {
    clearTimeout(hideTimer);
    return;
  }

  // Find the closest media element (walks up the DOM for video player overlays)
  const media = findMediaEl(target);
  if (media) {
    const rawSrc = extractSrc(media);
    if (!rawSrc) return;
    const url = getAbsoluteUrl(rawSrc);
    if (!url || !url.startsWith("http")) return;

    activeMediaUrl = url;
    showMdpBtn(media);
  } else {
    hideTimer = window.setTimeout(() => { mdpBtn.style.display = "none"; }, 400);
  }
}, true);

mdpBtn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
mdpBtn.addEventListener("mouseleave", () => {
  hideTimer = window.setTimeout(() => { mdpBtn.style.display = "none"; }, 400);
});
