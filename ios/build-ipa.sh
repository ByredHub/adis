#!/bin/bash
# Builds and signs Adis.ipa (ad-hoc) on a Mac with Xcode. Same steps as .github/workflows/ios.yml.
#
# Usage (from the ios/ folder):
#   ./build-ipa.sh path/to/cert.p12 path/to/profile.mobileprovision [p12-password]
# Result: ios/build/export/Adis.ipa
set -euo pipefail
cd "$(dirname "$0")"

P12="${1:?Укажи путь к .p12}"
PROFILE="${2:?Укажи путь к .mobileprovision}"
P12_PASSWORD="${3:-}"
TEAM_ID="LWGNB3QJ4H"
PROFILE_UUID="931d2b40-a18c-4812-934e-22f115a48126"

command -v xcodebuild >/dev/null || { echo "Нужен Xcode (App Store), затем: sudo xcode-select -s /Applications/Xcode.app"; exit 1; }
if ! command -v xcodegen >/dev/null; then
  command -v brew >/dev/null || { echo "Нужен Homebrew: https://brew.sh"; exit 1; }
  brew install xcodegen
fi

echo "==> Временная связка ключей с сертификатом"
KEYCHAIN="$PWD/build/adis-signing.keychain-db"
mkdir -p build
security delete-keychain "$KEYCHAIN" 2>/dev/null || true
security create-keychain -p adis-tmp "$KEYCHAIN"
security set-keychain-settings -t 3600 -u "$KEYCHAIN"
security unlock-keychain -p adis-tmp "$KEYCHAIN"
security import "$P12" -k "$KEYCHAIN" -P "$P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k adis-tmp "$KEYCHAIN" >/dev/null
ORIGINAL_KEYCHAINS=$(security list-keychains -d user | tr -d '"')
security list-keychains -d user -s "$KEYCHAIN" $ORIGINAL_KEYCHAINS
cleanup() { security list-keychains -d user -s $ORIGINAL_KEYCHAINS; security delete-keychain "$KEYCHAIN" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> Профиль подготовки"
for dir in "$HOME/Library/MobileDevice/Provisioning Profiles" "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"; do
  mkdir -p "$dir"
  cp "$PROFILE" "$dir/$PROFILE_UUID.mobileprovision"
done

echo "==> Иконка"
ICONSET="Adis/Assets.xcassets/AppIcon.appiconset"
mkdir -p "$ICONSET"
sips -z 1024 1024 Assets/icon-512.png --out "$ICONSET/icon-1024.png" >/dev/null
cat > "$ICONSET/Contents.json" <<'EOF'
{"images":[{"size":"1024x1024","idiom":"universal","platform":"ios","filename":"icon-1024.png"}],"info":{"version":1,"author":"xcode"}}
EOF
cat > Adis/Assets.xcassets/Contents.json <<'EOF'
{"info":{"version":1,"author":"xcode"}}
EOF

echo "==> Xcode-проект"
xcodegen generate

echo "==> Сборка (несколько минут)"
xcodebuild -project Adis.xcodeproj -scheme Adis -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/Adis.xcarchive archive \
  CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_IDENTITY="iPhone Distribution" \
  PROVISIONING_PROFILE_SPECIFIER="$PROFILE_UUID" OTHER_CODE_SIGN_FLAGS="--keychain $KEYCHAIN" | tail -5

echo "==> Экспорт IPA"
xcodebuild -exportArchive -archivePath build/Adis.xcarchive -exportPath build/export -exportOptionsPlist exportOptions.plist | tail -3

echo
echo "Готово: $PWD/build/export/Adis.ipa"
