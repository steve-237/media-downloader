import { useEffect, useState } from 'react';
import { Download, Search, Maximize2, Check, X, ChevronDown, Film, Music, FileText, Image as ImageIcon } from 'lucide-react';

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

export default function Popup() {
  const [images, setImages] = useState<MediaItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewImage, setPreviewImage] = useState<MediaItem | null>(null);
  const [selectedQualityUrl, setSelectedQualityUrl] = useState<string>("");
  const [filter, setFilter] = useState<MediaType | 'all'>('all');

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
      const activeTab = tabs[0];
      if (!activeTab || !activeTab.id) return;

      const tabId = activeTab.id;
      let domMedia: MediaItem[] = [];
      let netMedia: MediaItem[] = [];
      let streamMedia: MediaItem[] = [];

      const updateImages = () => {
        const all = [...streamMedia, ...domMedia, ...netMedia]; // Streams first for visibility
        const seen = new Set<string>();
        const unique = all.filter(item => {
          const url = item.variants?.[0]?.url || item.thumbnail;
          if (seen.has(url)) return false;
          seen.add(url);
          return true;
        });
        setImages(unique);
      };

      // 1. Fetch DOM & Performance media from content script
      chrome.tabs.sendMessage(tabId, { action: "SCAN_MEDIA" }, (response: any) => {
        if (chrome.runtime.lastError) {
          console.warn("MDP: Content script not responding.", chrome.runtime.lastError.message);
        } else if (response && response.images) {
          domMedia = response.images;
          updateImages();
        }
      });

      // 2. Fetch network-intercepted media + streams from background script
      chrome.runtime.sendMessage({ action: "GET_NETWORK_MEDIA", tabId }, (response: any) => {
        if (chrome.runtime.lastError) {
          console.warn("MDP: Background script not responding.", chrome.runtime.lastError.message);
          return;
        }

        // Process direct network media
        if (response && response.media) {
          let idCounter = 1000;
          netMedia = response.media
            .filter((nm: any) => nm.type !== 'image')
            .map((nm: any) => {
              let label = nm.type === 'video' ? 'Vidéo' : nm.type === 'audio' ? 'Audio' : 'Fichier';
              if (nm.size && nm.size > 0) {
                label += ` (${(nm.size / (1024 * 1024)).toFixed(1)} MB)`;
              }
              const title = nm.filename || nm.url.split('/').pop()?.split('?')[0] || undefined;
              return {
                id: `net_${idCounter++}`,
                type: nm.type,
                thumbnail: '',
                title: title ? decodeURIComponent(title) : undefined,
                variants: [{ url: nm.url, label: `${label} (Réseau)` }]
              };
            });
        }

        // Process captured streams (HLS/DASH)
        if (response && response.streams && response.streams.length > 0) {
          let streamCounter = 2000;
          streamMedia = response.streams.map((s: any) => ({
            id: `stream_${streamCounter++}`,
            type: 'video' as MediaType,
            thumbnail: '',
            title: `🎬 Flux ${s.type.toUpperCase()} détecté`,
            variants: [{
              url: `STREAM::${s.type}::${s.manifestUrl}`,
              label: `Télécharger le flux ${s.type.toUpperCase()}`
            }]
          }));
        }

        updateImages();
      });

    });
  }, []);

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const filteredMedia = images.filter(img => filter === 'all' || img.type === filter);

  const selectAll = () => {
    if (selectedIds.size === filteredMedia.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredMedia.map(img => img.id)));
    }
  };

  const downloadUrls = (urls: string[]) => {
    urls.forEach(url => {
      // Handle stream downloads (HLS/DASH)
      if (url.startsWith('STREAM::')) {
        const parts = url.split('::');
        const streamType = parts[1]; // 'hls' or 'dash'
        const manifestUrl = parts.slice(2).join('::'); // Rest is the URL (may contain ::)
        console.log(`MDP popup: starting ${streamType} stream download`, manifestUrl);
        chrome.runtime.sendMessage(
          { action: "DOWNLOAD_STREAM", manifestUrl, streamType },
          (resp) => {
            if (chrome.runtime.lastError) {
              console.error("MDP popup: stream download failed:", chrome.runtime.lastError.message);
            } else if (resp && resp.error) {
              console.error("MDP popup: stream error:", resp.error);
              alert(`Erreur: ${resp.error}`);
            } else {
              console.log("MDP popup: stream download started");
            }
          }
        );
        return;
      }

      // Handle direct file downloads
      let filename: string | undefined;
      try {
        const seg = new URL(url).pathname.split('/').pop();
        if (seg && seg.includes('.')) filename = decodeURIComponent(seg.split('?')[0]);
      } catch { /* ignore */ }

      chrome.downloads.download({
        url,
        filename,
        conflictAction: "uniquify",
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.warn("MDP popup: direct download failed, trying via background:", chrome.runtime.lastError.message);
          chrome.runtime.sendMessage({ action: "DOWNLOAD", urls: [url] });
        } else {
          console.log("MDP popup: download started, ID:", downloadId);
        }
      });
    });
  };

  const handleDownloadSelected = () => {
    const urlsToDownload = images
      .filter(img => selectedIds.has(img.id))
      .map(img => img.variants?.[0]?.url || img.thumbnail); 
    downloadUrls(urlsToDownload);
  };

  const openPreview = (img: MediaItem) => {
    if (img.type !== 'image') return; // Only preview images as requested
    setPreviewImage(img);
    setSelectedQualityUrl(img.variants?.[0]?.url || img.thumbnail);
  };

  const renderThumbnail = (img: MediaItem) => {
    if (img.type === 'image' || (img.type === 'video' && img.thumbnail)) {
      return <img src={img.thumbnail} className="object-cover w-full h-full" alt="thumbnail" />;
    }
    // Fallbacks
    return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-gray-100 text-gray-400 p-4">
        {img.type === 'video' && <Film size={32} />}
        {img.type === 'audio' && <Music size={32} />}
        {img.type === 'document' && <FileText size={32} />}
        {img.title && <p className="text-[10px] font-medium text-gray-500 mt-2 text-center line-clamp-2">{img.title}</p>}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#f5f5f7] text-gray-900 overflow-hidden font-sans">
      
      {/* Header - Apple Style */}
      <div className="flex flex-col pt-5 pb-3 px-5 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 z-20 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Médias</h1>
        
        {/* Category Filters */}
        <div className="flex items-center space-x-2 mt-4 overflow-x-auto pb-1 scrollbar-hide">
          {[
            { id: 'all', label: 'Tous' },
            { id: 'image', label: 'Images', icon: <ImageIcon size={14} /> },
            { id: 'video', label: 'Vidéos', icon: <Film size={14} /> },
            { id: 'audio', label: 'Audios', icon: <Music size={14} /> },
            { id: 'document', label: 'Docs', icon: <FileText size={14} /> }
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setFilter(cat.id as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors
                ${filter === cat.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className="text-xs font-medium text-gray-500">
            {filteredMedia.length} élément{filteredMedia.length > 1 ? 's' : ''} affiché{filteredMedia.length > 1 ? 's' : ''}
          </span>
          <button 
            onClick={selectAll}
            className="text-xs font-semibold text-blue-500 hover:text-blue-600 transition-colors active:opacity-70"
          >
            {selectedIds.size === filteredMedia.length && filteredMedia.length > 0 ? "Tout désélectionner" : "Tout sélectionner"}
          </button>
        </div>
      </div>

      {/* Content Grid */}
      <div className="flex-1 overflow-y-auto p-4 relative z-0">
        {filteredMedia.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-3">
            <Search size={48} className="opacity-20" strokeWidth={1.5} />
            <p className="text-sm font-medium">Aucun média trouvé</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 pb-24">
            {filteredMedia.map((img) => {
              const isSelected = selectedIds.has(img.id);
              return (
                <div 
                  key={img.id} 
                  className={`group relative aspect-square bg-white rounded-2xl overflow-hidden shadow-sm transition-all duration-300
                    ${isSelected ? 'ring-4 ring-blue-500 ring-offset-2 ring-offset-[#f5f5f7] scale-[0.96]' : 'hover:shadow-md hover:scale-[1.02] border border-gray-100'}`}
                >
                  {renderThumbnail(img)}
                  
                  {/* Selection Checkbox */}
                  <button 
                    onClick={() => toggleSelection(img.id)}
                    className={`absolute top-2 left-2 p-1.5 rounded-full shadow-sm transition-all z-10 backdrop-blur-md
                      ${isSelected ? 'bg-blue-500 text-white' : 'bg-black/20 text-transparent hover:bg-black/30'}`}
                  >
                    <Check size={16} strokeWidth={3} />
                  </button>

                  {/* Type Badge */}
                  {img.type !== 'image' && (
                    <div className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 text-white backdrop-blur-md">
                      {img.type === 'video' && <Film size={14} />}
                      {img.type === 'audio' && <Music size={14} />}
                      {img.type === 'document' && <FileText size={14} />}
                    </div>
                  )}

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2 pointer-events-none">
                    <div className="flex justify-between items-center w-full pointer-events-auto gap-2">
                      {img.type === 'image' ? (
                        <button 
                          onClick={() => openPreview(img)}
                          className="bg-white/80 backdrop-blur-md hover:bg-white text-gray-900 p-2 rounded-xl shadow-lg transition-transform hover:scale-105 active:scale-95"
                          title="Aperçu"
                        >
                          <Maximize2 size={16} strokeWidth={2} />
                        </button>
                      ) : <div className="flex-1"></div>}

                      {/* Direct Download */}
                      <div className="flex items-stretch bg-blue-500/90 backdrop-blur-md rounded-xl shadow-lg text-white hover:bg-blue-500 transition-colors">
                        <button 
                          onClick={() => downloadUrls([img.variants?.[0]?.url || img.thumbnail])}
                          className="px-3 py-2 font-medium border-r border-blue-400/50 flex-1 flex justify-center active:bg-blue-600 rounded-l-xl"
                        >
                          <Download size={16} />
                        </button>
                        {img.variants?.length > 1 && (
                          <div className="relative group/dropdown flex">
                            <button className="px-2 py-2 flex items-center justify-center active:bg-blue-600 rounded-r-xl">
                              <ChevronDown size={16} />
                            </button>
                            <div className="absolute bottom-full right-0 mb-2 hidden group-hover/dropdown:block bg-white/95 backdrop-blur-xl border border-gray-100 rounded-xl shadow-xl overflow-hidden w-36 z-20 p-1">
                              {img.variants?.map((v, i) => (
                                <button
                                  key={i}
                                  onClick={() => downloadUrls([v.url])}
                                  className="w-full text-left px-3 py-2.5 text-xs font-medium text-gray-800 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors truncate block"
                                >
                                  {v.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Action */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#f5f5f7] via-[#f5f5f7]/90 to-transparent pt-12 z-10">
        <button 
          onClick={handleDownloadSelected}
          disabled={selectedIds.size === 0}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3.5 px-4 rounded-2xl shadow-lg shadow-blue-500/30 transition-all active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 disabled:shadow-none flex items-center justify-center gap-2"
        >
          <Download size={20} strokeWidth={2.5} />
          Télécharger ({selectedIds.size})
        </button>
      </div>

      {/* Preview Lightbox / Modal */}
      {previewImage && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-xl flex flex-col transition-all duration-300">
          <div className="flex justify-between items-center p-4 bg-transparent">
            <h2 className="font-semibold text-white/90 text-lg drop-shadow-md">Aperçu</h2>
            <button 
              onClick={() => setPreviewImage(null)}
              className="p-2 text-white/70 hover:text-white bg-black/20 hover:bg-black/40 rounded-full backdrop-blur-md transition-all active:scale-95"
            >
              <X size={20} strokeWidth={2.5} />
            </button>
          </div>

          <div className="flex-1 p-4 flex items-center justify-center overflow-hidden">
            <img 
              src={selectedQualityUrl} 
              className="object-contain max-w-full max-h-full rounded-xl shadow-2xl" 
              alt="preview" 
            />
          </div>

          <div className="p-6 bg-white rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)] space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider ml-1">Sélectionner la qualité</label>
              <div className="relative">
                <select 
                  value={selectedQualityUrl}
                  onChange={(e) => setSelectedQualityUrl(e.target.value)}
                  className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-800 text-sm font-medium rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block p-3.5 pr-10 outline-none cursor-pointer transition-shadow"
                >
                  {previewImage.variants?.map((v, i) => (
                    <option key={i} value={v.url}>
                      {v.label} {v.width ? `(${v.width}px)` : ''}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                  <ChevronDown size={16} />
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => {
                downloadUrls([selectedQualityUrl]);
                setPreviewImage(null);
              }}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <Download size={20} strokeWidth={2.5} />
              Enregistrer l'image
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
