console.log("Media Downloader Pro: Background service worker active.");

// ============================================================
// NETWORK MEDIA INTERCEPTOR
// ============================================================

interface CapturedMedia {
  url: string;
  type: string;
  tabId: number;
  timestamp: number;
  contentType?: string;
  filename?: string;
  size?: number;
}

interface CapturedStream {
  manifestUrl: string;
  type: 'hls' | 'dash';
  tabId: number;
  timestamp: number;
  pageUrl?: string;
}

// Store captured media and streams per tab
const capturedMedia = new Map<number, CapturedMedia[]>();
const capturedStreams = new Map<number, CapturedStream[]>();

// MIME types
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/ogg', 'video/avi', 'video/quicktime', 'video/x-matroska', 'video/x-flv', 'video/3gpp'];
const STREAM_MIMES = ['application/x-mpegurl', 'application/vnd.apple.mpegurl', 'application/dash+xml', 'audio/mpegurl'];
const AUDIO_MIMES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/opus'];
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif', 'image/bmp'];
const DOC_MIMES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'];

const VIDEO_EXTS = ['.mp4', '.webm', '.ogg', '.ogv', '.avi', '.mov', '.mkv', '.m4v', '.flv', '.3gp'];
const STREAM_EXTS = ['.m3u8', '.mpd'];
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

function classifyMedia(contentType: string, url: string): { type: string; isStream: boolean } | null {
  const ct = contentType.toLowerCase().split(';')[0].trim();
  const ext = getExtFromUrl(url);

  // Check streams first
  if (STREAM_MIMES.some(m => ct.includes(m)) || STREAM_EXTS.includes(ext)) {
    return { type: ext === '.mpd' || ct.includes('dash') ? 'dash' : 'hls', isStream: true };
  }
  if (VIDEO_MIMES.some(m => ct.includes(m)) || VIDEO_EXTS.includes(ext)) {
    return { type: 'video', isStream: false };
  }
  if (AUDIO_MIMES.some(m => ct.includes(m)) || AUDIO_EXTS.includes(ext)) {
    return { type: 'audio', isStream: false };
  }
  if (IMAGE_MIMES.some(m => ct.includes(m))) {
    return { type: 'image', isStream: false };
  }
  if (DOC_MIMES.some(m => ct.includes(m)) || DOC_EXTS.includes(ext)) {
    return { type: 'document', isStream: false };
  }
  return null;
}

// ============================================================
// NETWORK INTERCEPTION
// ============================================================

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (details.url.startsWith('chrome-extension://') || details.url.startsWith('data:') || details.url.startsWith('blob:')) return;

    let contentType = '';
    let contentLength = 0;

    if (details.responseHeaders) {
      for (const header of details.responseHeaders) {
        const name = header.name.toLowerCase();
        if (name === 'content-type' && header.value) contentType = header.value;
        if (name === 'content-length' && header.value) contentLength = parseInt(header.value, 10);
      }
    }

    const classification = classifyMedia(contentType, details.url);
    if (!classification) return;

    if (classification.isStream) {
      // Store as stream manifest
      if (!capturedStreams.has(details.tabId)) capturedStreams.set(details.tabId, []);
      const tabStreams = capturedStreams.get(details.tabId)!;
      if (!tabStreams.some(s => s.manifestUrl === details.url)) {
        tabStreams.push({
          manifestUrl: details.url,
          type: classification.type as 'hls' | 'dash',
          tabId: details.tabId,
          timestamp: Date.now(),
        });
        console.log(`MDP [NET]: Captured ${classification.type} manifest from tab ${details.tabId}: ${details.url.substring(0, 100)}`);
      }
      return;
    }

    // Skip tiny images
    if (classification.type === 'image' && contentLength > 0 && contentLength < 5000) return;

    const entry: CapturedMedia = {
      url: details.url,
      type: classification.type,
      tabId: details.tabId,
      timestamp: Date.now(),
      contentType,
      filename: getFilenameFromUrl(details.url),
      size: contentLength > 0 ? contentLength : undefined,
    };

    if (!capturedMedia.has(details.tabId)) capturedMedia.set(details.tabId, []);
    const tabMedia = capturedMedia.get(details.tabId)!;
    if (!tabMedia.some(m => m.url === entry.url)) {
      tabMedia.push(entry);
      console.log(`MDP [NET]: Captured ${classification.type} from tab ${details.tabId}: ${entry.filename || entry.url.substring(0, 80)}`);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Cleanup on tab close/navigate
chrome.tabs.onRemoved.addListener((tabId) => {
  capturedMedia.delete(tabId);
  capturedStreams.delete(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    capturedMedia.delete(tabId);
    capturedStreams.delete(tabId);
  }
});

// ============================================================
// HLS (.m3u8) PARSER & DOWNLOADER
// ============================================================

interface HlsVariant {
  url: string;
  bandwidth?: number;
  resolution?: string;
}

/** Parse an HLS master playlist and return variant streams sorted by bandwidth (highest first) */
function parseHlsMaster(content: string, baseUrl: string): HlsVariant[] {
  const lines = content.split('\n').map(l => l.trim());
  const variants: HlsVariant[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = lines[i].substring(18);
      const bwMatch = attrs.match(/BANDWIDTH=(\d+)/);
      const resMatch = attrs.match(/RESOLUTION=(\S+)/);
      const nextLine = lines[i + 1];
      if (nextLine && !nextLine.startsWith('#')) {
        const url = nextLine.startsWith('http') ? nextLine : new URL(nextLine, baseUrl).href;
        variants.push({
          url,
          bandwidth: bwMatch ? parseInt(bwMatch[1], 10) : undefined,
          resolution: resMatch ? resMatch[1] : undefined,
        });
      }
    }
  }

  return variants.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
}

/** Parse an HLS media playlist and return segment URLs */
function parseHlsMedia(content: string, baseUrl: string): string[] {
  const lines = content.split('\n').map(l => l.trim());
  const segments: string[] = [];

  for (const line of lines) {
    if (line && !line.startsWith('#')) {
      const url = line.startsWith('http') ? line : new URL(line, baseUrl).href;
      segments.push(url);
    }
  }

  return segments;
}

/** Check if content is a master playlist (has EXT-X-STREAM-INF) */
function isMasterPlaylist(content: string): boolean {
  return content.includes('#EXT-X-STREAM-INF:');
}

/** Download all segments and concatenate them into a single Blob */
async function downloadHlsStream(manifestUrl: string, sendProgress: (msg: string) => void): Promise<{ blob: Blob; filename: string }> {
  sendProgress("Fetching manifest...");

  // Step 1: Fetch the manifest
  const manifestResp = await fetch(manifestUrl);
  if (!manifestResp.ok) throw new Error(`Failed to fetch manifest: ${manifestResp.status}`);
  let manifestContent = await manifestResp.text();

  // Step 2: If it's a master playlist, get the best quality variant
  let mediaPlaylistUrl = manifestUrl;
  if (isMasterPlaylist(manifestContent)) {
    const variants = parseHlsMaster(manifestContent, manifestUrl);
    if (variants.length === 0) throw new Error("No variants found in master playlist");

    // Pick highest quality
    const best = variants[0];
    sendProgress(`Selected quality: ${best.resolution || 'best'} (${best.bandwidth ? Math.round(best.bandwidth / 1000) + ' kbps' : 'unknown bitrate'})`);

    mediaPlaylistUrl = best.url;
    const mediaResp = await fetch(mediaPlaylistUrl);
    if (!mediaResp.ok) throw new Error(`Failed to fetch media playlist: ${mediaResp.status}`);
    manifestContent = await mediaResp.text();
  }

  // Step 3: Parse segments
  const segmentUrls = parseHlsMedia(manifestContent, mediaPlaylistUrl);
  if (segmentUrls.length === 0) throw new Error("No segments found in playlist");

  sendProgress(`Found ${segmentUrls.length} segments. Downloading...`);

  // Step 4: Download all segments with concurrency control
  const CONCURRENCY = 4;
  const chunks: ArrayBuffer[] = new Array(segmentUrls.length);
  let downloaded = 0;

  async function downloadSegment(index: number): Promise<void> {
    const resp = await fetch(segmentUrls[index]);
    if (!resp.ok) throw new Error(`Segment ${index + 1} failed: ${resp.status}`);
    chunks[index] = await resp.arrayBuffer();
    downloaded++;
    if (downloaded % 10 === 0 || downloaded === segmentUrls.length) {
      sendProgress(`Downloaded ${downloaded}/${segmentUrls.length} segments (${Math.round(downloaded / segmentUrls.length * 100)}%)`);
    }
  }

  // Process in batches
  for (let i = 0; i < segmentUrls.length; i += CONCURRENCY) {
    const batch = [];
    for (let j = i; j < Math.min(i + CONCURRENCY, segmentUrls.length); j++) {
      batch.push(downloadSegment(j));
    }
    await Promise.all(batch);
  }

  sendProgress("Assembling video file...");

  // Step 5: Concatenate all chunks
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  // Determine file extension based on first segment
  const firstSegExt = getExtFromUrl(segmentUrls[0]);
  const ext = firstSegExt === '.ts' ? '.ts' : firstSegExt === '.mp4' ? '.mp4' : '.ts';

  // Generate filename from manifest URL or page
  let filename = getFilenameFromUrl(manifestUrl) || 'video';
  filename = filename.replace('.m3u8', '').replace('.mpd', '');
  if (!filename.includes('.')) filename += ext;

  const blob = new Blob([combined], { type: ext === '.mp4' ? 'video/mp4' : 'video/mp2t' });

  sendProgress(`Complete! ${(totalSize / (1024 * 1024)).toFixed(1)} MB`);

  return { blob, filename };
}

// ============================================================
// DASH (.mpd) BASIC PARSER & DOWNLOADER
// ============================================================

/** Parse a simple DASH MPD and extract segment URLs for the highest quality video */
async function downloadDashStream(mpdUrl: string, sendProgress: (msg: string) => void): Promise<{ blob: Blob; filename: string }> {
  sendProgress("Fetching DASH manifest...");

  const resp = await fetch(mpdUrl);
  if (!resp.ok) throw new Error(`Failed to fetch MPD: ${resp.status}`);
  const mpdText = await resp.text();

  // Parse XML
  const parser = new DOMParser();
  const doc = parser.parseFromString(mpdText, 'text/xml');

  // Find all video AdaptationSets
  const adaptationSets = doc.querySelectorAll('AdaptationSet');
  let bestVideoUrl: string | null = null;
  let bestBandwidth = 0;

  for (const as of adaptationSets) {
    const mimeType = as.getAttribute('mimeType') || '';
    const contentType = as.getAttribute('contentType') || '';
    const isVideo = mimeType.includes('video') || contentType === 'video';
    
    if (!isVideo) continue;

    const representations = as.querySelectorAll('Representation');
    for (const rep of representations) {
      const bw = parseInt(rep.getAttribute('bandwidth') || '0', 10);
      if (bw > bestBandwidth) {
        bestBandwidth = bw;
        // Look for BaseURL first
        const baseUrl = rep.querySelector('BaseURL');
        if (baseUrl && baseUrl.textContent) {
          bestVideoUrl = baseUrl.textContent.startsWith('http')
            ? baseUrl.textContent
            : new URL(baseUrl.textContent, mpdUrl).href;
        }
      }
    }
  }

  if (bestVideoUrl) {
    sendProgress("Downloading video stream...");
    const videoResp = await fetch(bestVideoUrl);
    if (!videoResp.ok) throw new Error(`Failed to fetch video: ${videoResp.status}`);
    const buffer = await videoResp.arrayBuffer();
    const blob = new Blob([buffer], { type: 'video/mp4' });

    let filename = getFilenameFromUrl(mpdUrl) || 'video';
    filename = filename.replace('.mpd', '.mp4');

    sendProgress(`Complete! ${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB`);
    return { blob, filename };
  }

  throw new Error("No video representation found in DASH manifest");
}

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
        const streams = capturedStreams.get(tabId) || [];
        console.log(`MDP: Returning ${media.length} media + ${streams.length} streams for tab ${tabId}`);
        sendResponse({ media, streams });
      } else {
        sendResponse({ media: [], streams: [] });
      }
      return true;
    }

    // -- Download files (direct URL) --
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

    // -- Download the best intercepted video (direct MP4, or stream) --
    if (request.action === "DOWNLOAD_BEST_VIDEO") {
      const tabId = request.tabId || sender.tab?.id;
      if (!tabId) {
        sendResponse({ error: "No tab ID" });
        return true;
      }

      // First check for direct video files
      const media = capturedMedia.get(tabId) || [];
      const videos = media.filter(m => m.type === 'video');

      if (videos.length > 0) {
        // Sort by size descending, pick the largest
        videos.sort((a, b) => (b.size || 0) - (a.size || 0));
        const best = videos[0];
        const filename = best.filename || getFilenameFromUrl(best.url) || "video.mp4";
        console.log("MDP: Downloading best direct video", best.url);

        chrome.downloads.download(
          { url: best.url, filename, conflictAction: "uniquify" },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              sendResponse({ error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ status: "ok", downloadId });
            }
          }
        );
        return true;
      }

      // Then check for streams
      const streams = capturedStreams.get(tabId) || [];
      if (streams.length > 0) {
        const stream = streams[streams.length - 1]; // Most recent stream

        console.log(`MDP: Downloading ${stream.type} stream:`, stream.manifestUrl);

        const downloadFn = stream.type === 'hls' ? downloadHlsStream : downloadDashStream;

        downloadFn(stream.manifestUrl, (msg) => {
          console.log("MDP [STREAM]:", msg);
        })
          .then(({ blob, filename }) => {
            // Convert blob to data URL for chrome.downloads
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              chrome.downloads.download(
                { url: dataUrl, filename, conflictAction: "uniquify" },
                (downloadId) => {
                  if (chrome.runtime.lastError) {
                    sendResponse({ error: chrome.runtime.lastError.message });
                  } else {
                    sendResponse({ status: "ok", downloadId, type: "stream" });
                  }
                }
              );
            };
            reader.readAsDataURL(blob);
          })
          .catch((err: Error) => {
            console.error("MDP: Stream download failed:", err.message);
            sendResponse({ error: `Stream download failed: ${err.message}` });
          });

        return true;
      }

      sendResponse({ error: "No video or stream captured for this tab" });
      return true;
    }

    // -- Download a specific HLS/DASH stream --
    if (request.action === "DOWNLOAD_STREAM") {
      const manifestUrl = request.manifestUrl;
      const streamType = request.streamType || 'hls';

      if (!manifestUrl) {
        sendResponse({ error: "No manifest URL" });
        return true;
      }

      console.log(`MDP: Starting ${streamType} stream download:`, manifestUrl);

      const downloadFn = streamType === 'hls' ? downloadHlsStream : downloadDashStream;

      downloadFn(manifestUrl, (msg) => {
        console.log("MDP [STREAM]:", msg);
        // Send progress to any listening popup
        chrome.runtime.sendMessage({ action: "STREAM_PROGRESS", message: msg }).catch(() => {});
      })
        .then(({ blob, filename }) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            chrome.downloads.download(
              { url: dataUrl, filename, conflictAction: "uniquify" },
              (downloadId) => {
                if (chrome.runtime.lastError) {
                  sendResponse({ error: chrome.runtime.lastError.message });
                } else {
                  sendResponse({ status: "ok", downloadId });
                }
              }
            );
          };
          reader.readAsDataURL(blob);
        })
        .catch((err: Error) => {
          console.error("MDP: Stream download failed:", err.message);
          sendResponse({ error: `Stream download failed: ${err.message}` });
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
