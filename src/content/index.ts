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
    } catch (e) {
      // invalid URL
    }
  }
  return variants;
}

function getAbsoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, window.location.href).href;
  } catch (e) {
    return null;
  }
}

// Common video/audio file extensions for link scanning
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
// Media Detection Engine
// ---------------------------------------------------------

chrome.runtime.onMessage.addListener((request: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (request.action === "SCAN_MEDIA") {
    const mediaItems: MediaItem[] = [];
    let idCounter = 0;

    // =====================================================
    // 1. Scan Images (<img>, <picture>)
    // =====================================================
    const imgElements = Array.from(document.querySelectorAll('img'));
    imgElements.forEach(img => {
      const rawSrc = img.currentSrc || img.src;
      const absUrl = getAbsoluteUrl(rawSrc);
      if (!absUrl || !absUrl.startsWith('http')) return;
      
      let rawVariants: { url: string; width?: number }[] = [{ url: absUrl }];
      if (img.srcset) rawVariants.push(...parseSrcset(img.srcset));

      const parent = img.parentElement;
      if (parent && parent.tagName.toLowerCase() === 'picture') {
        const sources = Array.from(parent.querySelectorAll('source'));
        sources.forEach(source => {
          if (source.srcset) rawVariants.push(...parseSrcset(source.srcset));
        });
      }

      const uniqueVariantsMap = new Map<string, { url: string; width?: number }>();
      rawVariants.forEach(v => {
        if (!uniqueVariantsMap.has(v.url)) {
          uniqueVariantsMap.set(v.url, v);
        } else {
          const existing = uniqueVariantsMap.get(v.url);
          if (!existing?.width && v.width) uniqueVariantsMap.set(v.url, v);
        }
      });

      const processedVariants = Array.from(uniqueVariantsMap.values())
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

      mediaItems.push({
        id: `media_${idCounter++}`,
        type: 'image',
        thumbnail: absUrl,
        variants: processedVariants
      });
    });

    // =====================================================
    // 2. Scan Videos (<video> tags, including nested <source>)
    // =====================================================
    const videoElements = Array.from(document.querySelectorAll('video'));
    videoElements.forEach(video => {
      const sources: string[] = [];
      
      // Try direct src
      if (video.src && !video.src.startsWith('blob:')) {
        const abs = getAbsoluteUrl(video.src);
        if (abs) sources.push(abs);
      }
      
      // Try currentSrc
      if (video.currentSrc && !video.currentSrc.startsWith('blob:') && !sources.includes(video.currentSrc)) {
        const abs = getAbsoluteUrl(video.currentSrc);
        if (abs && !sources.includes(abs)) sources.push(abs);
      }
      
      // Try all nested <source> elements
      const sourceElements = Array.from(video.querySelectorAll('source'));
      sourceElements.forEach(source => {
        const srcAttr = source.src || source.getAttribute('src');
        if (srcAttr && !srcAttr.startsWith('blob:')) {
          const abs = getAbsoluteUrl(srcAttr);
          if (abs && !sources.includes(abs)) sources.push(abs);
        }
      });

      const poster = getAbsoluteUrl(video.poster) || '';
      
      if (sources.length > 0) {
        const variants: MediaVariant[] = sources.map((s, i) => ({
          url: s,
          label: sources.length > 1 ? `Source ${i + 1}` : "Vidéo"
        }));

        mediaItems.push({
          id: `media_${idCounter++}`,
          type: 'video',
          thumbnail: poster,
          title: getFilenameFromUrl(sources[0]) || undefined,
          variants
        });
      }
    });

    // =====================================================
    // 3. Scan Audio (<audio> tags, including nested <source>)
    // =====================================================
    const audioElements = Array.from(document.querySelectorAll('audio'));
    audioElements.forEach(audio => {
      const sources: string[] = [];
      
      if (audio.src && !audio.src.startsWith('blob:')) {
        const abs = getAbsoluteUrl(audio.src);
        if (abs) sources.push(abs);
      }
      
      if (audio.currentSrc && !audio.currentSrc.startsWith('blob:') && !sources.includes(audio.currentSrc)) {
        const abs = getAbsoluteUrl(audio.currentSrc);
        if (abs && !sources.includes(abs)) sources.push(abs);
      }
      
      const sourceElements = Array.from(audio.querySelectorAll('source'));
      sourceElements.forEach(source => {
        const srcAttr = source.src || source.getAttribute('src');
        if (srcAttr && !srcAttr.startsWith('blob:')) {
          const abs = getAbsoluteUrl(srcAttr);
          if (abs && !sources.includes(abs)) sources.push(abs);
        }
      });

      if (sources.length > 0) {
        const variants: MediaVariant[] = sources.map((s, i) => ({
          url: s,
          label: sources.length > 1 ? `Source ${i + 1}` : "Audio"
        }));

        mediaItems.push({
          id: `media_${idCounter++}`,
          type: 'audio',
          thumbnail: '',
          title: getFilenameFromUrl(sources[0]) || undefined,
          variants
        });
      }
    });

    // =====================================================
    // 4. Scan ALL links (<a href>) for video, audio & doc files
    // =====================================================
    const linkElements = Array.from(document.querySelectorAll('a[href]'));
    linkElements.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;
      
      const absUrl = getAbsoluteUrl(href);
      if (!absUrl || !absUrl.startsWith('http')) return;

      const ext = getFileExtension(absUrl);
      if (!ext) return;

      const linkText = link.textContent?.trim() || '';
      const filename = getFilenameFromUrl(absUrl) || linkText || 'Fichier';

      if (videoExtensions.includes(ext)) {
        mediaItems.push({
          id: `media_${idCounter++}`,
          type: 'video',
          thumbnail: '',
          title: filename,
          variants: [{ url: absUrl, label: `Vidéo (${ext.replace('.', '').toUpperCase()})` }]
        });
      } else if (audioExtensions.includes(ext)) {
        mediaItems.push({
          id: `media_${idCounter++}`,
          type: 'audio',
          thumbnail: '',
          title: filename,
          variants: [{ url: absUrl, label: `Audio (${ext.replace('.', '').toUpperCase()})` }]
        });
      } else if (documentExtensions.includes(ext)) {
        mediaItems.push({
          id: `media_${idCounter++}`,
          type: 'document',
          thumbnail: '',
          title: filename,
          variants: [{ url: absUrl, label: `Fichier (${ext.replace('.', '').toUpperCase()})` }]
        });
      }
    });

    // =====================================================
    // 5. Scan <embed>, <object>, <iframe> for media sources
    // =====================================================
    const embedElements = Array.from(document.querySelectorAll('embed[src], object[data], iframe[src]'));
    embedElements.forEach(el => {
      const src = el.getAttribute('src') || el.getAttribute('data');
      if (!src || src.startsWith('blob:')) return;
      const absUrl = getAbsoluteUrl(src);
      if (!absUrl || !absUrl.startsWith('http')) return;

      const ext = getFileExtension(absUrl);
      if (videoExtensions.includes(ext)) {
        mediaItems.push({
          id: `media_${idCounter++}`,
          type: 'video',
          thumbnail: '',
          title: getFilenameFromUrl(absUrl) || undefined,
          variants: [{ url: absUrl, label: `Vidéo intégrée` }]
        });
      } else if (audioExtensions.includes(ext)) {
        mediaItems.push({
          id: `media_${idCounter++}`,
          type: 'audio',
          thumbnail: '',
          title: getFilenameFromUrl(absUrl) || undefined,
          variants: [{ url: absUrl, label: `Audio intégré` }]
        });
      } else if (ext === '.pdf') {
        mediaItems.push({
          id: `media_${idCounter++}`,
          type: 'document',
          thumbnail: '',
          title: getFilenameFromUrl(absUrl) || 'Document PDF',
          variants: [{ url: absUrl, label: `PDF intégré` }]
        });
      }
    });

    // =====================================================
    // 6. Scan CSS background-images for hidden media
    // =====================================================
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
      const style = window.getComputedStyle(el);
      const bg = style.backgroundImage;
      if (bg && bg !== 'none') {
        const urlMatch = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
        if (urlMatch && urlMatch[1]) {
          const absUrl = urlMatch[1];
          // Only add if it looks like an actual image (not a tiny icon/sprite)
          const rect = el.getBoundingClientRect();
          if (rect.width > 80 && rect.height > 80) {
            mediaItems.push({
              id: `media_${idCounter++}`,
              type: 'image',
              thumbnail: absUrl,
              variants: [{ url: absUrl, label: "Background Image" }]
            });
          }
        }
      }
    });
    
    // =====================================================
    // Deduplicate by URL
    // =====================================================
    const uniqueMediaMap = new Map<string, MediaItem>();
    mediaItems.forEach(item => {
      const key = item.variants[0]?.url || item.thumbnail;
      if (!uniqueMediaMap.has(key)) {
        uniqueMediaMap.set(key, item);
      }
    });

    const finalItems = Array.from(uniqueMediaMap.values());
    console.log(`Media Downloader Pro: ${finalItems.length} media items detected (${mediaItems.length} before dedup).`);
    sendResponse({ images: finalItems });
  }
  return true;
});


// ---------------------------------------------------------
// On-Page Floating Download Button (Much more visible)
// ---------------------------------------------------------

let activeMediaUrl = "";

// Create a wrapper to isolate styles via Shadow DOM
const btnWrapper = document.createElement("div");
btnWrapper.id = "mdp-btn-wrapper";
btnWrapper.style.cssText = "position: absolute; z-index: 2147483647; display: none; pointer-events: none; top: 0; left: 0;";
document.body.appendChild(btnWrapper);

const shadow = btnWrapper.attachShadow({ mode: 'closed' });

const btnStyle = document.createElement('style');
btnStyle.textContent = `
  @keyframes mdpSlideIn {
    from { opacity: 0; transform: translateY(-6px) scale(0.9); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes mdpPulse {
    0%, 100% { box-shadow: 0 4px 20px rgba(0, 122, 255, 0.5); }
    50% { box-shadow: 0 4px 28px rgba(0, 122, 255, 0.8); }
  }
  .mdp-btn {
    all: initial;
    display: flex;
    align-items: center;
    gap: 6px;
    background: linear-gradient(135deg, #007AFF 0%, #0055D4 100%);
    color: white;
    border: 2px solid rgba(255,255,255,0.35);
    border-radius: 10px;
    padding: 8px 14px;
    cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.3px;
    box-shadow: 0 4px 20px rgba(0, 122, 255, 0.5), 0 2px 8px rgba(0,0,0,0.2);
    animation: mdpSlideIn 0.2s ease-out, mdpPulse 2s ease-in-out infinite;
    pointer-events: auto;
    user-select: none;
    -webkit-user-select: none;
    transition: transform 0.15s ease, background 0.2s ease;
    text-shadow: 0 1px 2px rgba(0,0,0,0.2);
  }
  .mdp-btn:hover {
    transform: scale(1.08);
    background: linear-gradient(135deg, #0088FF 0%, #0060E8 100%);
  }
  .mdp-btn:active {
    transform: scale(0.95);
  }
  .mdp-btn svg {
    flex-shrink: 0;
  }
  .mdp-btn.success {
    background: linear-gradient(135deg, #34C759 0%, #248A3D 100%);
    box-shadow: 0 4px 20px rgba(52, 199, 89, 0.5), 0 2px 8px rgba(0,0,0,0.2);
    animation: mdpSlideIn 0.15s ease-out;
  }
`;
shadow.appendChild(btnStyle);

const hoverBtn = document.createElement("button");
hoverBtn.className = "mdp-btn";
const downloadSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const checkSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

hoverBtn.innerHTML = `${downloadSvg}<span>⬇ MDP</span>`;
shadow.appendChild(hoverBtn);

hoverBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (activeMediaUrl) {
    chrome.runtime.sendMessage({ action: "DOWNLOAD", urls: [activeMediaUrl] });
    
    // Success feedback
    hoverBtn.className = "mdp-btn success";
    hoverBtn.innerHTML = `${checkSvg}<span>Téléchargé !</span>`;
    
    setTimeout(() => {
      btnWrapper.style.display = 'none';
      setTimeout(() => {
        hoverBtn.className = "mdp-btn";
        hoverBtn.innerHTML = `${downloadSvg}<span>⬇ MDP</span>`;
      }, 300);
    }, 800);
  }
});

let hideTimeout: number | undefined;

function positionButton(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  
  // Don't show on tiny elements (icons, avatars)
  if (rect.width < 60 || rect.height < 60) return;
  
  btnWrapper.style.display = 'block';
  
  // Position top-right of the element with 10px padding
  const top = window.scrollY + rect.top + 10;
  const left = window.scrollX + rect.right - 10 - 120; // ~120px estimated button width
  
  btnWrapper.style.top = `${top}px`;
  btnWrapper.style.left = `${left}px`;
}

document.addEventListener('mouseover', (e) => {
  const target = e.target as HTMLElement;
  
  // Check if hovering over our own button wrapper
  if (target === btnWrapper || btnWrapper.contains(target)) {
    clearTimeout(hideTimeout);
    return;
  }
  
  const isMedia = target.tagName === 'IMG' || target.tagName === 'VIDEO' || target.tagName === 'AUDIO';
  
  if (isMedia) {
    clearTimeout(hideTimeout);
    
    let src = (target as HTMLImageElement | HTMLVideoElement).currentSrc || (target as any).src;
    
    // For video, also try poster or source children
    if (!src && target.tagName === 'VIDEO') {
      const sourceEl = target.querySelector('source');
      if (sourceEl) src = sourceEl.src;
    }
    
    if (!src || src.startsWith('blob:')) return;
    
    const absUrl = getAbsoluteUrl(src);
    if (!absUrl || !absUrl.startsWith('http')) return;

    activeMediaUrl = absUrl;

    positionButton(target);
  } else {
    hideTimeout = window.setTimeout(() => {
      btnWrapper.style.display = 'none';
    }, 300);
  }
}, true);

// Also keep button visible when mouse is over the button wrapper itself
btnWrapper.addEventListener('mouseenter', () => {
  clearTimeout(hideTimeout);
});

btnWrapper.addEventListener('mouseleave', () => {
  hideTimeout = window.setTimeout(() => {
    btnWrapper.style.display = 'none';
  }, 300);
});
