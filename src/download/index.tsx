import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface HlsVariant {
  url: string;
  bandwidth?: number;
  resolution?: string;
}

function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const seg = pathname.split('/').pop();
    if (seg && seg.includes('.')) return decodeURIComponent(seg.split('?')[0]);
  } catch { /* ignore */ }
  return 'video';
}

function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname.split('?')[0];
    const dot = pathname.lastIndexOf('.');
    return dot >= 0 ? pathname.substring(dot).toLowerCase() : '';
  } catch { return ''; }
}

// HLS Parsers
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

function DownloadApp() {
  const [status, setStatus] = useState<string>('Initialisation...');
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<boolean>(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState<string>('video.mp4');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const manifestUrl = params.get('manifestUrl');
    const streamType = params.get('type') || 'hls';

    if (!manifestUrl) {
      setError("Aucune URL de vidéo fournie.");
      return;
    }

    startDownload(manifestUrl, streamType as 'hls' | 'dash');
  }, []);

  const triggerFileDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    setDownloadFilename(filename);
    setCompleted(true);
    setStatus('Téléchargement terminé !');
    setProgress(100);

    // Auto trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      // We do not revoke the object URL immediately, so the user can click the manual button if needed
    }, 1000);
  };

  const startDownload = async (manifestUrl: string, streamType: 'hls' | 'dash') => {
    try {
      if (streamType === 'hls') {
        await downloadHls(manifestUrl);
      } else {
        await downloadDash(manifestUrl);
      }
    } catch (err: any) {
      setError(err.message || 'Erreur inconnue');
    }
  };

  const downloadHls = async (manifestUrl: string) => {
    setStatus("Récupération du manifest HLS...");
    setProgress(5);

    const manifestResp = await fetch(manifestUrl);
    if (!manifestResp.ok) throw new Error(`Échec de récupération du manifest: ${manifestResp.status}`);
    let manifestContent = await manifestResp.text();

    let mediaPlaylistUrl = manifestUrl;
    if (manifestContent.includes('#EXT-X-STREAM-INF:')) {
      const variants = parseHlsMaster(manifestContent, manifestUrl);
      if (variants.length === 0) throw new Error("Aucune qualité trouvée dans le manifest master");
      const best = variants[0];
      setStatus(`Qualité sélectionnée: ${best.resolution || 'maximale'}`);
      
      mediaPlaylistUrl = best.url;
      const mediaResp = await fetch(mediaPlaylistUrl);
      if (!mediaResp.ok) throw new Error(`Échec de récupération de la playlist média: ${mediaResp.status}`);
      manifestContent = await mediaResp.text();
    }

    const segmentUrls = parseHlsMedia(manifestContent, mediaPlaylistUrl);
    if (segmentUrls.length === 0) throw new Error("Aucun segment trouvé");

    setStatus(`Téléchargement de ${segmentUrls.length} segments en cours...`);
    setProgress(10);

    const CONCURRENCY = 4;
    const chunks: ArrayBuffer[] = new Array(segmentUrls.length);
    let downloaded = 0;

    async function downloadSegment(index: number): Promise<void> {
      let attempts = 0;
      while (attempts < 3) {
        try {
          const resp = await fetch(segmentUrls[index]);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          chunks[index] = await resp.arrayBuffer();
          downloaded++;
          const currentProgress = 10 + Math.floor((downloaded / segmentUrls.length) * 80);
          setProgress(currentProgress);
          setStatus(`Téléchargement: ${downloaded}/${segmentUrls.length} segments`);
          return;
        } catch (e) {
          attempts++;
          if (attempts >= 3) throw new Error(`Échec du segment ${index + 1}: ${e}`);
          await new Promise(r => setTimeout(r, 1000 * attempts));
        }
      }
    }

    for (let i = 0; i < segmentUrls.length; i += CONCURRENCY) {
      const batch = [];
      for (let j = i; j < Math.min(i + CONCURRENCY, segmentUrls.length); j++) {
        batch.push(downloadSegment(j));
      }
      await Promise.all(batch);
    }

    setStatus("Assemblage du fichier vidéo...");
    setProgress(95);

    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    const firstSegExt = getExtFromUrl(segmentUrls[0]);
    const ext = firstSegExt === '.ts' ? '.ts' : firstSegExt === '.mp4' ? '.mp4' : '.ts';

    let filename = getFilenameFromUrl(manifestUrl) || 'video';
    filename = filename.replace('.m3u8', '').replace('.mpd', '');
    if (!filename.includes('.')) filename += ext;

    const blob = new Blob([combined], { type: ext === '.mp4' ? 'video/mp4' : 'video/mp2t' });
    triggerFileDownload(blob, filename);
  };

  const downloadDash = async (mpdUrl: string) => {
    setStatus("Récupération du manifest DASH...");
    setProgress(10);

    const resp = await fetch(mpdUrl);
    if (!resp.ok) throw new Error(`Échec de récupération du MPD: ${resp.status}`);
    const mpdText = await resp.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(mpdText, 'text/xml');

    const adaptationSets = doc.querySelectorAll('AdaptationSet');
    let bestVideoUrl: string | null = null;
    let bestBandwidth = 0;

    for (const as of Array.from(adaptationSets)) {
      const mimeType = as.getAttribute('mimeType') || '';
      const contentType = as.getAttribute('contentType') || '';
      const isVideo = mimeType.includes('video') || contentType === 'video';
      
      if (!isVideo) continue;

      const representations = as.querySelectorAll('Representation');
      for (const rep of Array.from(representations)) {
        const bw = parseInt(rep.getAttribute('bandwidth') || '0', 10);
        if (bw > bestBandwidth) {
          bestBandwidth = bw;
          const baseUrl = rep.querySelector('BaseURL');
          if (baseUrl && baseUrl.textContent) {
            bestVideoUrl = baseUrl.textContent.startsWith('http')
              ? baseUrl.textContent
              : new URL(baseUrl.textContent, mpdUrl).href;
          }
        }
      }
    }

    if (!bestVideoUrl) {
      throw new Error("Aucun flux vidéo trouvé dans le manifest DASH");
    }

    setStatus("Téléchargement du flux vidéo...");
    setProgress(50);

    const videoResp = await fetch(bestVideoUrl);
    if (!videoResp.ok) throw new Error(`Échec du téléchargement: ${videoResp.status}`);
    
    // Pour les flux DASH simples qui ont un seul BaseURL
    const buffer = await videoResp.arrayBuffer();
    const blob = new Blob([buffer], { type: 'video/mp4' });

    let filename = getFilenameFromUrl(mpdUrl) || 'video';
    filename = filename.replace('.mpd', '.mp4');

    triggerFileDownload(blob, filename);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-4 font-sans">
      <div className="bg-white/80 backdrop-blur-xl border border-gray-200/50 shadow-xl rounded-3xl p-8 max-w-md w-full">
        
        <div className="flex flex-col items-center justify-center space-y-6">
          <div className="bg-blue-500 rounded-2xl p-4 shadow-lg shadow-blue-500/30">
            <Download size={32} className="text-white" strokeWidth={2.5} />
          </div>
          
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Media Downloader Pro</h1>
            <p className="text-sm font-medium text-gray-500 mt-1">Téléchargement de flux vidéo</p>
          </div>

          {!error && !completed && (
            <div className="w-full space-y-4">
              <div className="flex items-center justify-center space-x-2 text-blue-600">
                <Loader2 size={18} className="animate-spin" />
                <span className="font-semibold text-sm">{status}</span>
              </div>
              
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-200/50">
                <div 
                  className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <p className="text-right text-xs font-bold text-gray-400">{progress}%</p>
            </div>
          )}

          {error && (
            <div className="w-full bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start space-x-3 text-red-600">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <div className="text-sm font-medium leading-relaxed">
                <p className="font-bold mb-1">Erreur de téléchargement</p>
                {error}
              </div>
            </div>
          )}

          {completed && (
            <div className="w-full space-y-4 flex flex-col items-center">
              <div className="flex items-center space-x-2 text-green-600">
                <CheckCircle2 size={24} strokeWidth={2.5} />
                <span className="font-bold">Téléchargement terminé !</span>
              </div>
              
              <p className="text-sm text-gray-500 text-center px-4">
                Le fichier a été enregistré. Si le téléchargement n'a pas démarré automatiquement, cliquez ci-dessous.
              </p>
              
              {downloadUrl && (
                <a 
                  href={downloadUrl} 
                  download={downloadFilename}
                  className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-green-500/30 transition-all active:scale-[0.98] text-center"
                >
                  Enregistrer manuellement
                </a>
              )}
            </div>
          )}
        </div>
        
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<DownloadApp />);
