# Résumé des Nouveautés - Parseurs Vidéo Avancés

L'extension Media Downloader Pro intègre désormais de vrais algorithmes pour décoder les flux vidéos complexes et capturer l'intégralité du contenu, pas seulement la première seconde.

## Changements Majeurs :

1. **Parseur DASH (`.mpd`) Avancé :**
   - L'extension lit désormais les balises `<SegmentTemplate>` et `<SegmentTimeline>`.
   - Au lieu de récupérer uniquement l'adresse de base, l'extension calcule mathématiquement toutes les adresses de chaque fragment de la vidéo en injectant le `$Number$` correct pour chaque milliseconde de vidéo, sur la base de la chronologie.
   - Le fragment d'initialisation (`init.mp4` ou `init.m4s`) est téléchargé en tout premier, ce qui garantit que la vidéo assemblée est lisible par les lecteurs comme VLC.

2. **Parseur HLS (`.m3u8`) Avancé :**
   - Le code détecte maintenant l'en-tête de lecture avec `#EXT-X-MAP:URI`.
   - Si la vidéo utilise le codec moderne `fMP4` fractionné, l'extension n'oubliera plus de récupérer l'en-tête crucial, évitant ainsi les corruptions de fichiers.

## Validation 
- Les modifications ont été compilées.
- Poussées sur GitHub (Commit `98ada3a`).

> [!TIP]
> Lorsque vous téléchargez un flux, la barre de progression affichera désormais beaucoup plus de segments en cours de traitement (pouvant aller jusqu'à plusieurs centaines pour un long film !).
