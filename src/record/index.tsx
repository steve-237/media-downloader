import { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { MonitorPlay, StopCircle, Video, CheckCircle2, AlertCircle } from 'lucide-react';

function RecordApp() {
  const [status, setStatus] = useState<'idle' | 'recording' | 'completed' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [recordedSize, setRecordedSize] = useState<number>(0);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser' // Prompts for tab preferably
        },
        audio: true
      });

      streamRef.current = stream;
      chunksRef.current = [];

      // Detect if user stopped sharing via Chrome UI
      stream.getVideoTracks()[0].onended = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      };

      const options = { mimeType: 'video/webm;codecs=vp9,opus' };
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          // Calculate approx size
          const totalSize = chunksRef.current.reduce((acc, chunk) => acc + chunk.size, 0);
          setRecordedSize(totalSize);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        setStatus('completed');
        
        // Stop all tracks to clear the red dot
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
        
        // Auto trigger download
        triggerDownload(url, `capture_${Date.now()}.webm`);
      };

      mediaRecorder.start(1000); // Collect data every second
      setStatus('recording');

    } catch (err: any) {
      console.error(err);
      if (err.name !== 'NotAllowedError') {
        setError(err.message || 'Erreur lors de la capture');
        setStatus('error');
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-4 font-sans">
      <div className="bg-white/80 backdrop-blur-xl border border-gray-200/50 shadow-xl rounded-3xl p-8 max-w-md w-full">
        <div className="flex flex-col items-center justify-center space-y-6 text-center">
          
          <div className={`rounded-2xl p-4 shadow-lg transition-colors ${
            status === 'recording' ? 'bg-red-500 shadow-red-500/30 animate-pulse' : 
            status === 'completed' ? 'bg-green-500 shadow-green-500/30' : 
            'bg-gray-900 shadow-gray-900/30'
          }`}>
            {status === 'recording' ? (
              <Video size={32} className="text-white" strokeWidth={2.5} />
            ) : status === 'completed' ? (
              <CheckCircle2 size={32} className="text-white" strokeWidth={2.5} />
            ) : (
              <MonitorPlay size={32} className="text-white" strokeWidth={2.5} />
            )}
          </div>
          
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Capture d'Écran</h1>
            <p className="text-sm font-medium text-gray-500 mt-2 leading-relaxed">
              Pour sauvegarder une vidéo protégée, enregistrez directement l'onglet où elle est jouée.
            </p>
          </div>

          {status === 'idle' && (
            <div className="w-full space-y-4 pt-4">
              <div className="text-left bg-blue-50 text-blue-800 p-4 rounded-2xl text-xs font-medium space-y-2">
                <p>👉 Cliquez sur <b>Démarrer</b></p>
                <p>👉 Choisissez l'onglet Chrome qui contient la vidéo.</p>
                <p>👉 Cochez impérativement <b>"Partager l'audio de l'onglet"</b>.</p>
                <p>👉 Lancez la lecture de la vidéo.</p>
              </div>
              <button 
                onClick={startRecording}
                className="w-full bg-gray-900 hover:bg-black text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg transition-all active:scale-[0.98]"
              >
                Démarrer l'enregistrement
              </button>
            </div>
          )}

          {status === 'recording' && (
            <div className="w-full space-y-4 pt-4">
              <div className="flex flex-col items-center space-y-2 bg-red-50 text-red-600 p-4 rounded-2xl border border-red-100">
                <div className="flex items-center space-x-2">
                  <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"></div>
                  <span className="font-bold">Enregistrement en cours...</span>
                </div>
                <span className="text-xs font-medium">Taille : {(recordedSize / (1024 * 1024)).toFixed(1)} Mo</span>
              </div>
              <button 
                onClick={stopRecording}
                className="w-full flex items-center justify-center space-x-2 bg-red-500 hover:bg-red-600 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-red-500/30 transition-all active:scale-[0.98]"
              >
                <StopCircle size={20} />
                <span>Arrêter et Sauvegarder</span>
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="w-full bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start space-x-3 text-red-600">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <div className="text-sm font-medium leading-relaxed text-left">
                <p className="font-bold mb-1">Erreur de capture</p>
                {error}
              </div>
            </div>
          )}

          {status === 'completed' && (
            <div className="w-full space-y-4 pt-2 flex flex-col items-center">
              <p className="text-sm text-gray-500 px-4">
                L'enregistrement a été sauvegardé avec succès dans vos téléchargements.
              </p>
              {videoUrl && (
                <a 
                  href={videoUrl} 
                  download={`capture_${Date.now()}.webm`}
                  className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-green-500/30 transition-all active:scale-[0.98] text-center"
                >
                  Télécharger à nouveau
                </a>
              )}
              <button 
                onClick={() => setStatus('idle')}
                className="text-sm text-gray-500 hover:text-gray-800 font-medium mt-2"
              >
                Faire un nouvel enregistrement
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<RecordApp />);
