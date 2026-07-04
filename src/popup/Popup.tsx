import { useEffect, useState } from 'react';
import { Download, Search, Maximize2, Check, X, CheckSquare, Square, ChevronDown } from 'lucide-react';

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

export default function Popup() {
  const [images, setImages] = useState<MediaItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewImage, setPreviewImage] = useState<MediaItem | null>(null);
  const [selectedQualityUrl, setSelectedQualityUrl] = useState<string>("");

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
      const activeTab = tabs[0];
      if (activeTab && activeTab.id) {
        chrome.tabs.sendMessage(activeTab.id, { action: "SCAN_IMAGES" }, (response: any) => {
          if (chrome.runtime.lastError) {
            console.warn("Could not connect to content script. Please refresh the page.");
            return;
          }
          if (response && response.images) {
            setImages(response.images);
          }
        });
      }
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

  const selectAll = () => {
    if (selectedIds.size === images.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(images.map(img => img.id)));
    }
  };

  const downloadUrls = (urls: string[]) => {
    chrome.runtime.sendMessage({ action: "DOWNLOAD", urls });
  };

  const handleDownloadSelected = () => {
    const urlsToDownload = images
      .filter(img => selectedIds.has(img.id))
      .map(img => img.variants?.[0]?.url || img.thumbnail); // default to best quality (index 0)
    downloadUrls(urlsToDownload);
  };

  const openPreview = (img: MediaItem) => {
    setPreviewImage(img);
    setSelectedQualityUrl(img.variants?.[0]?.url || img.thumbnail);
  };

  return (
    <div className="flex flex-col h-full w-full bg-white text-slate-900 overflow-hidden font-sans">
      
      {/* Header */}
      <div className="flex flex-col p-4 border-b border-slate-200 shadow-sm z-10 bg-white">
        <h1 className="text-xl font-semibold tracking-tight">Media Downloader</h1>
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-slate-600">{images.length} éléments détectés</span>
          </div>
          <button 
            onClick={selectAll}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-1"
          >
            {selectedIds.size === images.length && images.length > 0 ? <CheckSquare size={14} /> : <Square size={14} />}
            Tout sélectionner
          </button>
        </div>
      </div>

      {/* Content Grid */}
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50 relative">
        {images.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Search size={40} className="mb-3 opacity-20" />
            <p className="text-sm font-medium">Aucun média détecté</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 pb-4">
            {images.map((img) => {
              const isSelected = selectedIds.has(img.id);
              return (
                <div 
                  key={img.id} 
                  className={`group relative aspect-square bg-white rounded-xl overflow-hidden border-2 transition-all shadow-sm
                    ${isSelected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <img src={img.thumbnail} className="object-cover w-full h-full" alt="thumbnail" />
                  
                  {/* Selection Checkbox (Top Left) */}
                  <button 
                    onClick={() => toggleSelection(img.id)}
                    className={`absolute top-2 left-2 p-1 rounded bg-white shadow border transition-colors z-10
                      ${isSelected ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300 text-transparent group-hover:text-slate-300 hover:border-slate-400'}`}
                  >
                    <Check size={14} strokeWidth={3} />
                  </button>

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 pointer-events-none">
                    <div className="flex justify-between items-center w-full pointer-events-auto">
                      <button 
                        onClick={() => openPreview(img)}
                        className="bg-white/90 hover:bg-white text-slate-800 p-1.5 rounded-md shadow backdrop-blur-sm transition-transform hover:scale-105"
                        title="Aperçu"
                      >
                        <Maximize2 size={16} />
                      </button>

                      {/* Direct Download with Quality Select */}
                      <div className="relative flex items-center bg-blue-600 rounded-md shadow text-white hover:bg-blue-700 transition-colors">
                        <button 
                          onClick={() => downloadUrls([img.variants[0]?.url || img.thumbnail])}
                          className="px-2.5 py-1.5 font-medium text-xs border-r border-blue-500/50"
                        >
                          <Download size={14} />
                        </button>
                        {img.variants?.length > 1 && (
                          <div className="relative group/dropdown">
                            <button className="px-1.5 py-1.5 flex items-center">
                              <ChevronDown size={14} />
                            </button>
                            <div className="absolute bottom-full right-0 mb-1 hidden group-hover/dropdown:block bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden w-32 z-20">
                              {img.variants?.map((v, i) => (
                                <button
                                  key={i}
                                  onClick={() => downloadUrls([v.url])}
                                  className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 border-b border-slate-100 last:border-0 truncate block"
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
      <div className="p-4 border-t border-slate-200 bg-white">
        <button 
          onClick={handleDownloadSelected}
          disabled={selectedIds.size === 0}
          className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2"
        >
          <Download size={18} />
          Télécharger la sélection ({selectedIds.size})
        </button>
      </div>

      {/* Preview Lightbox / Modal */}
      {previewImage && (
        <div className="absolute inset-0 z-50 bg-white flex flex-col transition-all duration-200">
          {/* Lightbox Header */}
          <div className="flex justify-between items-center p-4 border-b border-slate-100 shadow-sm">
            <h2 className="font-semibold text-slate-800 truncate flex-1 pr-4">Aperçu détaillé</h2>
            <button 
              onClick={() => setPreviewImage(null)}
              className="p-1 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Lightbox Image */}
          <div className="flex-1 bg-slate-50 p-4 flex items-center justify-center overflow-hidden">
            <div className="relative w-full h-full rounded-lg border border-slate-200 overflow-hidden shadow-sm bg-white">
              <img 
                src={selectedQualityUrl} 
                className="object-contain w-full h-full" 
                alt="preview" 
              />
            </div>
          </div>

          {/* Lightbox Footer (Download controls) */}
          <div className="p-4 border-t border-slate-100 bg-white space-y-3 shadow-lg">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Qualité</label>
              <select 
                value={selectedQualityUrl}
                onChange={(e) => setSelectedQualityUrl(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 outline-none cursor-pointer"
              >
                {previewImage.variants?.map((v, i) => (
                  <option key={i} value={v.url}>
                    {v.label} {v.width ? `(${v.width}px)` : ''}
                  </option>
                ))}
              </select>
            </div>
            
            <button 
              onClick={() => {
                downloadUrls([selectedQualityUrl]);
                setPreviewImage(null);
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <Download size={18} />
              Télécharger l'image
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
