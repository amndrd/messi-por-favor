#!/bin/bash
# Messi por favor — lancement de secours, si le bouton « ▶ Messi por favor » ne marche pas.
# Le site tourne tant que cette fenêtre est ouverte.
cd "$(dirname "$0")"
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then ARCH=arm64; else ARCH=x64; fi
chmod +x outils/* 2>/dev/null
echo ""
echo "  Messi por favor — démarrage…"
./outils/node-$ARCH server.js
echo ""
read -p "Le site est arrêté. Appuie sur Entrée pour fermer cette fenêtre…"
