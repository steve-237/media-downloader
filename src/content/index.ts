console.log("Media Downloader: Content script injected!");

export interface MediaVariant {
  url: string;
  width?: number;
  label: string;
}

export interface MediaItem {
  id: string;
  thumbnail: string;
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
    
    // Convert relative URLs to absolute if needed
    try {
      const absoluteUrl = new URL(url, window.location.href).href;
      variants.push({ url: absoluteUrl, width: isNaN(width!) ? undefined : width });
    } catch (e) {
      // invalid URL
    }
  }
  return variants;
}

chrome.runtime.onMessage.addListener((request: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (request.action === "SCAN_IMAGES") {
    const mediaItems: MediaItem[] = [];
    let idCounter = 0;

    // Scan all <img> tags
    const imgElements = Array.from(document.querySelectorAll('img'));
    
    imgElements.forEach(img => {
      const rawSrc = img.currentSrc || img.src;
      if (!rawSrc || !rawSrc.startsWith('http')) return;
      
      const thumbnail = rawSrc;
      let rawVariants: { url: string; width?: number }[] = [];

      // Add the default src
      rawVariants.push({ url: thumbnail });

      // Parse srcset if it exists on the img itself
      if (img.srcset) {
        rawVariants.push(...parseSrcset(img.srcset));
      }

      // Check if it's inside a <picture> tag
      const parent = img.parentElement;
      if (parent && parent.tagName.toLowerCase() === 'picture') {
        const sources = Array.from(parent.querySelectorAll('source'));
        sources.forEach(source => {
          if (source.srcset) {
            rawVariants.push(...parseSrcset(source.srcset));
          }
        });
      }

      // Remove duplicates by URL
      const uniqueVariantsMap = new Map<string, { url: string; width?: number }>();
      rawVariants.forEach(v => {
        if (!uniqueVariantsMap.has(v.url)) {
          uniqueVariantsMap.set(v.url, v);
        } else {
          // If we already have it, but the new one has a width, keep the width
          const existing = uniqueVariantsMap.get(v.url);
          if (!existing?.width && v.width) {
            uniqueVariantsMap.set(v.url, v);
          }
        }
      });

      const processedVariants = Array.from(uniqueVariantsMap.values())
        .sort((a, b) => (b.width || 0) - (a.width || 0)) // Sort descending by width
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
        id: `img_${idCounter++}`,
        thumbnail: thumbnail,
        variants: processedVariants
      });
    });
    
    // Deduplicate at the MediaItem level based on thumbnail URL
    const uniqueMediaMap = new Map<string, MediaItem>();
    mediaItems.forEach(item => {
      if (!uniqueMediaMap.has(item.thumbnail)) {
        uniqueMediaMap.set(item.thumbnail, item);
      }
    });

    const finalItems = Array.from(uniqueMediaMap.values());
    console.log(`Media Downloader: ${finalItems.length} images detected.`);
    sendResponse({ images: finalItems });
  }
  return true;
});
