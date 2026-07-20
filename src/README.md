# Documentation du Code Source (`/src`)

Ce dossier contient l'ensemble du code source TypeScript/React de l'extension Media Downloader Pro. L'architecture est divisée en plusieurs modules indépendants (Feature-First) qui communiquent entre eux via l'API de messages de Chrome (`chrome.runtime.sendMessage`).

## Structure des Dossiers

### 1. `background/` (Le Cerveau / Service Worker)
Agit comme le "Backend" de l'extension.
- **Fichier principal** : `background.ts`
- **Rôle** : Tourne de manière invisible en arrière-plan. Il utilise `chrome.webRequest.onCompleted` pour sniffer tout le trafic réseau de l'utilisateur.
- **Fonctionnalités** : 
  - Intercepte les fichiers `.mp4`, `.mp3`, `.m3u8` (HLS), et `.mpd` (DASH).
  - Gère les téléchargements natifs via l'API `chrome.downloads`.
  - Maintient un état temporaire des médias interceptés pour chaque onglet (`mediaCache`, `streamCache`).

### 2. `content/` (Les Yeux / Script de Contenu)
- **Fichier principal** : `content.ts`
- **Rôle** : Injecté dans chaque page web visitée par l'utilisateur.
- **Fonctionnalités** :
  - **Scanner DOM** : Fouille le code HTML pour trouver des balises `<img>`, `<video>`, `<audio>`.
  - **Scanner CSS** : Détecte les images chargées en `background-image`.
  - **Performance API** : Vérifie l'historique de chargement natif du navigateur.
  - **UI In-Page** : Injecte un bouton de téléchargement flottant ("MDP") directement sur les lecteurs vidéo.

### 3. `popup/` (L'Interface Principale / Frontend)
- **Fichier principal** : `Popup.tsx`
- **Rôle** : S'affiche lorsque l'utilisateur clique sur l'icône de l'extension.
- **Design System** : Utilise Tailwind CSS v4 pour une interface "Apple-like" (blur, ombres douces, coins arrondis).
- **Fonctionnalités** :
  - Interroge le Content Script et le Background Script pour consolider la liste de tous les médias trouvés.
  - Permet la prévisualisation des images, la sélection multiple, et le lancement des téléchargements.

### 4. `download/` (Le Moteur de Streaming)
- **Fichier principal** : `index.tsx`
- **Rôle** : Onglet dédié (qui s'ouvre en plein écran) pour gérer les téléchargements complexes de flux vidéo.
- **Fonctionnalité Clé** : Les Service Workers (MV3) ayant une limite stricte de mémoire (souvent ~50-100MB), le téléchargement de longs films HLS ou DASH faisait crasher l'extension ("Service Worker Registration Failed"). Ce module déporte cette charge dans un onglet standard.
- **Parseurs** :
  - Parseur HLS avancé gérant `#EXT-X-MAP`.
  - Parseur DASH robuste calculant la chronologie via `SegmentTemplate` et `SegmentTimeline`.

### 5. `record/` (Le Contournement DRM)
- **Fichier principal** : `index.tsx`
- **Rôle** : Onglet dédié à l'enregistrement vidéo de l'écran.
- **Fonctionnalité Clé** : Permet de capturer l'onglet via `navigator.mediaDevices.getDisplayMedia` et `MediaRecorder` pour télécharger légalement une vidéo protégée par Widevine ou PlayReady au format `.webm`.

---

## Flux de Données (Exemple : Streaming HLS)
1. Le navigateur charge une page de streaming.
2. Le `background.ts` intercepte la requête réseau `.m3u8` et la stocke en mémoire.
3. L'utilisateur ouvre le `Popup.tsx`, qui demande au `background.ts` la liste des flux.
4. L'utilisateur clique sur Télécharger. Le Popup ordonne au navigateur d'ouvrir la page `download.html`.
5. `download/index.tsx` s'ouvre, récupère le fichier `.m3u8`, décode tous les segments vidéo, les télécharge en parallèle (concurrence de 4), assemble le fichier vidéo binaire, et déclenche la sauvegarde sur le disque.
