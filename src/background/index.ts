console.log("Media Downloader Pro: Background service worker active.");

// ============================================================
// NETWORK MEDIA INTERCEPTOR
// Captures all media URLs flowing through the browser network
// ============================================================

interface CapturedMedia {
  url: string;
  type: string; // 'video' | 'audio' | 'image' | 'document'
  tabId: number;
  timestamp: number;
  contentType?: string;
  filename?: string;
  size?: number;
}

// Store captured media per tab
const capturedMedia = new Map<number, CapturedMedia[]>();

// Media MIME types to capture
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/ogg', 'video/avi', 'video/quicktime', 'video/x-matroska', 'video/x-flv', 'video/3gpp', 'application/x-mpegurl', 'application/vnd.apple.mpegurl', 'application/dash+xml'];
const AUDIO_MIMES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/opus'];
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif', 'image/bmp'];
const DOC_MIMES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'];

// File extensions for fallback detection
const VIDEO_EXTS = ['.mp4', '.webm', '.ogg', '.ogv', '.avi', '.mov', '.mkv', '.m4v', '.flv', '.3gp', '.m3u8', '.mpd', '.ts'];
const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.aac', '.oga', '.m4a', '.wma', '.opus'];
const DOC_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.zip', '.txt', '.ppt', '.pptx', '.rar', '.7z'];

function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname.split('?')[0];
    const dot = pathname.lastIndexOf('.');
    return dot >= 0 ? pathname.substring(dot).toLowerCase() : '';
  } catch { return ''; }
}

function getFilenameFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const seg = pathname.split('/').pop();
    if (seg && seg.includes('.')) return decodeURIComponent(seg.split('?')[0]);
  } catch { /* ignore */ }
  return undefined;
}

function classifyByMime(contentType: string): string | null {
  const ct = contentType.toLowerCase().split(';')[0].trim();
  if (VIDEO_MIMES.some(m => ct.includes(m))) return 'video';
  if (AUDIO_MIMES.some(m => ct.includes(m))) return 'audio';
  if (IMAGE_MIMES.some(m => ct.includes(m))) return 'image';
  if (DOC_MIMES.some(m => ct.includes(m))) return 'document';
  return null;
}

function classifyByExtension(url: string): string | null {
  const ext = getExtFromUrl(url);
  if (!ext) return null;
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (DOC_EXTS.includes(ext)) return 'document';
  return null;
}

// Intercept completed network requests to detect media
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Skip extension's own requests and data URLs
    if (details.tabId < 0) return;
    if (details.url.startsWith('chrome-extension://')) return;
    if (details.url.startsWith('data:')) return;
    if (details.url.startsWith('blob:')) return;

    // Classify by response headers (Content-Type)
    let mediaType: string | null = null;
    let contentType = '';
    let contentLength = 0;

    if (details.responseHeaders) {
      for (const header of details.responseHeaders) {
        const name = header.name.toLowerCase();
        if (name === 'content-type' && header.value) {
          contentType = header.value;
          mediaType = classifyByMime(header.value);
        }
        if (name === 'content-length' && header.value) {
          contentLength = parseInt(header.value, 10);
        }
      }
    }

    // Fallback: classify by URL extension
    if (!mediaType) {
      mediaType = classifyByExtension(details.url);
    }

    if (!mediaType) return;

    // Skip very small files (icons, tracking pixels) for images
    if (mediaType === 'image' && contentLength > 0 && contentLength < 5000) return;

    const entry: CapturedMedia = {
      url: details.url,
      type: mediaType,
      tabId: details.tabId,
      timestamp: Date.now(),
      contentType,
      filename: getFilenameFromUrl(details.url),
      size: contentLength > 0 ? contentLength : undefined,
    };

    // Store per tab
    if (!capturedMedia.has(details.tabId)) {
      capturedMedia.set(details.tabId, []);
    }
    const tabMedia = capturedMedia.get(details.tabId)!;

    // Deduplicate
    if (!tabMedia.some(m => m.url === entry.url)) {
      tabMedia.push(entry);
      console.log(`MDP [NET]: Captured ${mediaType} from tab ${details.tabId}: ${entry.filename || entry.url.substring(0, 80)}`);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  capturedMedia.delete(tabId);
});

// Clean up when tab navigates to a new page
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    capturedMedia.delete(tabId);
  }
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  console.log("Media Downloader Extension Installed.");
});

chrome.runtime.onMessage.addListener(
  (request: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {

    // -- Return captured network media for a tab --
    if (request.action === "GET_NETWORK_MEDIA") {
      const tabId = request.tabId || sender.tab?.id;
      if (tabId) {
        const media = capturedMedia.get(tabId) || [];
        console.log(`MDP: Returning ${media.length} network-captured media for tab ${tabId}`);
        sendResponse({ media });
      } else {
        sendResponse({ media: [] });
      }
      return true;
    }

    // -- Download files --
    if (request.action === "DOWNLOAD") {
      const urls: string[] = request.urls;
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        sendResponse({ error: "No URLs provided" });
        return true;
      }

      let completed = 0;
      let failed = 0;
      const total = urls.length;

      urls.forEach((url: string) => {
        const filename = getFilenameFromUrl(url);
        console.log("MDP: Downloading", url, filename ? `as ${filename}` : "");

        chrome.downloads.download(
          { url, filename, conflictAction: "uniquify" },
          (downloadId) => {
            completed++;
            if (chrome.runtime.lastError) {
              failed++;
              console.error("MDP: Download failed:", url, chrome.runtime.lastError.message);
            } else {
              console.log("MDP: Download started, ID:", downloadId);
            }
            if (completed === total) {
              sendResponse({ status: failed === 0 ? "ok" : "partial", started: total - failed, failed });
            }
          }
        );
      });
      return true;
    }

    // -- Fallback: open URL in new tab --
    if (request.action === "DOWNLOAD_VIA_TAB") {
      const url: string = request.url;
      if (url) {
        chrome.tabs.create({ url, active: false }, (tab) => {
          if (tab.id) {
            setTimeout(() => { chrome.tabs.remove(tab.id!).catch(() => {}); }, 3000);
          }
        });
        sendResponse({ status: "ok" });
      }
      return true;
    }

    return false;
  }
);
