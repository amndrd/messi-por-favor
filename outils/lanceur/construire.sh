#!/bin/bash
# Fabrique « ▶ Messi por favor.app » à la racine du disque à partir de main.swift.
# Il faut Xcode (ou les outils en ligne de commande). Seulement pour modifier le bouton :
# la personne qui reçoit le disque n'en a pas besoin.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
DISQUE="$(cd "$ICI/../../.." && pwd)"
APP="$DISQUE/▶ Messi por favor.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

swiftc -O -target arm64-apple-macos11 "$ICI/main.swift" -o "$TMP/arm64"
swiftc -O -target x86_64-apple-macos10.15 "$ICI/main.swift" -o "$TMP/x64"
lipo -create "$TMP/arm64" "$TMP/x64" -output "$TMP/Messi por favor"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$TMP/Messi por favor" "$APP/Contents/MacOS/"
cp "$ICI/icone.icns" "$APP/Contents/Resources/icone.icns"
cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>Messi por favor</string>
	<key>CFBundleIdentifier</key>
	<string>local.messi-por-favor</string>
	<key>CFBundleName</key>
	<string>Messi por favor</string>
	<key>CFBundleDisplayName</key>
	<string>Messi por favor</string>
	<key>CFBundleIconFile</key>
	<string>icone</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>CFBundleDevelopmentRegion</key>
	<string>fr</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.15</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSRemovableVolumesUsageDescription</key>
	<string>Messi por favor lit les films de ce disque pour les afficher dans ton navigateur.</string>
</dict>
</plist>
EOF
# Signature « ad hoc » : obligatoire sur les Mac Apple Silicon, et permet à macOS
# de mémoriser l'autorisation d'accès au disque.
codesign --force --sign - "$APP"
codesign --verify --strict "$APP"
echo "OK : $APP"
