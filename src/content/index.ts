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

// ---------------------------------------------------------
// Media Detection Engine
// ---------------------------------------------------------

chrome.runtime.onMessage.addListener((request: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (request.action === "SCAN_MEDIA") {
    const mediaItems: MediaItem[] = [];
    let idCounter = 0;

    // 1. Scan Images
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

    // 2. Scan Videos
    const videoElements = Array.from(document.querySelectorAll('video'));
    videoElements.forEach(video => {
      let src = video.currentSrc || video.src;
      if (!src) {
        const source = video.querySelector('source');
        if (source) src = source.src;
      }
      const absUrl = getAbsoluteUrl(src);
      if (!absUrl || !absUrl.startsWith('http')) return;

      const poster = getAbsoluteUrl(video.poster) || '';
      
      mediaItems.push({
        id: `media_${idCounter++}`,
        type: 'video',
        thumbnail: poster, // Might be empty, popup will handle fallback
        variants: [{ url: absUrl, label: "Vidéo" }]
      });
    });

    // 3. Scan Audio
    const audioElements = Array.from(document.querySelectorAll('audio'));
    audioElements.forEach(audio => {
      let src = audio.currentSrc || audio.src;
      if (!src) {
        const source = audio.querySelector('source');
        if (source) src = source.src;
      }
      const absUrl = getAbsoluteUrl(src);
      if (!absUrl || !absUrl.startsWith('http')) return;

      mediaItems.push({
        id: `media_${idCounter++}`,
        type: 'audio',
        thumbnail: '', // No thumbnail for audio, handled in UI
        variants: [{ url: absUrl, label: "Audio" }]
      });
    });

    // 4. Scan Documents
    const documentExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.zip', '.txt'];
    const linkElements = Array.from(document.querySelectorAll('a'));
    linkElements.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;
      const lowerHref = href.toLowerCase();
      
      const isDocument = documentExtensions.some(ext => lowerHref.endsWith(ext) || lowerHref.includes(ext + '?'));
      if (isDocument) {
        const absUrl = getAbsoluteUrl(href);
        if (!absUrl || !absUrl.startsWith('http')) return;

        let title = link.textContent?.trim() || absUrl.split('/').pop()?.split('?')[0] || "Document sans titre";
        
        mediaItems.push({
          id: `media_${idCounter++}`,
          type: 'document',
          thumbnail: '',
          title: title,
          variants: [{ url: absUrl, label: "Fichier" }]
        });
      }
    });
    
    // Deduplicate
    const uniqueMediaMap = new Map<string, MediaItem>();
    mediaItems.forEach(item => {
      const key = item.variants[0]?.url || item.thumbnail;
      if (!uniqueMediaMap.has(key)) {
        uniqueMediaMap.set(key, item);
      }
    });

    const finalItems = Array.from(uniqueMediaMap.values());
    console.log(`Media Downloader Pro: ${finalItems.length} media items detected.`);
    sendResponse({ images: finalItems });
  }
  return true;
});


// ---------------------------------------------------------
// On-Page Floating Download Button
// ---------------------------------------------------------

let activeMediaUrl = "";

const hoverBtn = document.createElement("button");
hoverBtn.id = "mdp-quick-download-btn";
hoverBtn.innerHTML = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
  <span style="font-weight: 700; font-family: system-ui, sans-serif; font-size: 11px;">MDP</span>
`;
hoverBtn.style.cssText = `
  position: absolute;
  z-index: 2147483647;
  display: none;
  align-items: center;
  gap: 4px;
  background: rgba(0, 122, 255, 0.95);
  color: white;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  backdrop-filter: blur(8px);
  transition: transform 0.1s;
  pointer-events: auto;
`;

document.body.appendChild(hoverBtn);

hoverBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (activeMediaUrl) {
    chrome.runtime.sendMessage({ action: "DOWNLOAD", urls: [activeMediaUrl] });
    
    // Quick click animation
    hoverBtn.style.transform = "scale(0.9)";
    hoverBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <span style="font-weight: 700; font-family: system-ui, sans-serif; font-size: 11px;">OK</span>
    `;
    hoverBtn.style.background = "rgba(40, 199, 111, 0.95)";
    
    setTimeout(() => {
      hoverBtn.style.transform = "scale(1)";
      hoverBtn.style.display = "none";
      // Reset after a moment
      setTimeout(() => {
        hoverBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span style="font-weight: 700; font-family: system-ui, sans-serif; font-size: 11px;">MDP</span>
        `;
        hoverBtn.style.background = "rgba(0, 122, 255, 0.95)";
      }, 300);
    }, 200);
  }
});

let hideTimeout: number | undefined;

document.addEventListener('mouseover', (e) => {
  const target = e.target as HTMLElement;
  const isMedia = target.tagName === 'IMG' || target.tagName === 'VIDEO' || target.tagName === 'AUDIO';
  
  if (isMedia || target === hoverBtn || hoverBtn.contains(target)) {
    clearTimeout(hideTimeout);
    
    if (isMedia) {
      let src = (target as HTMLImageElement | HTMLVideoElement).currentSrc || (target as any).src;
      if (!src) return;
      
      const absUrl = getAbsoluteUrl(src);
      if (!absUrl || !absUrl.startsWith('http')) return;

      activeMediaUrl = absUrl;
      const rect = target.getBoundingClientRect();
      
      // Don't show on tiny icons
      if (rect.width < 50 || rect.height < 50) return;
      
      hoverBtn.style.display = 'flex';
      
      // Position top-right corner of the element, with a small 8px margin
      const top = window.scrollY + rect.top + 8;
      const left = window.scrollX + rect.right - 8 - hoverBtn.offsetWidth;
      
      hoverBtn.style.top = `${top}px`;
      hoverBtn.style.left = `${left}px`;
    }
  } else {
    hideTimeout = window.setTimeout(() => {
      hoverBtn.style.display = 'none';
    }, 200);
  }
}, true);
