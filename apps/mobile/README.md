# Reading Helper · Mobile (Android + iOS)

Offline Android and iOS companion app for Reading Helper. Built with Svelte 5, Vite 8, TypeScript, and Capacitor 8. Reads and writes directly to the local library folder synchronized via Syncthing.

---

## 1. Development & Local Testing

### Prerequisites
- Node.js v22+
- Chrome or Chromium for Playwright E2E tests

### Commands
```bash
cd apps/mobile

# Install dependencies
npm install

# Start local dev server (http://127.0.0.1:5174, backed by .scratch/library)
npm run dev

# Type check
npm run check

# Run unit tests (Vitest)
npm test

# Run E2E tests (Playwright mobile Pixel 7 viewport + touch emulation)
npm run e2e

# Generate 5,000-card synthetic library and run performance benchmarks
npm run perf

# Record an interactive demo video in the web emulator
npm run record
```

When opened on a desktop browser, the app automatically presents a realistic web-based phone emulator frame (412×915 px). On Chrome DevTools, toggle Device Toolbar (Ctrl+Shift+M / Cmd+Shift+M) or Pixel 7 to test with native touch gestures.

---

## 2. How the App Finds the Library

The app runs offline and reads the library directory directly from the filesystem using `@capacitor/filesystem` and the native `RangeFile` plugin. The folder is chosen with the system folder picker (**Choose folder…** on the Setup screen and in Settings), handled by the native `FolderPicker` plugin.

**Android**
1. **All Files Access**: Android 11+ (API 30+) requires `MANAGE_EXTERNAL_STORAGE` permission to read shared folders. The Setup screen checks this via `AllFilesPlugin` and opens the system setting if needed.
2. **Choose folder…** opens the system folder browser (`ACTION_OPEN_DOCUMENT_TREE`). The picked folder is turned back into an absolute path (`TreePaths.java`) and read by path, so the fast file I/O stays the same. Folders on internal storage and SD cards work; cloud providers (Drive etc.) are rejected. The path can still be typed by hand; the default is `/storage/emulated/0/Syncthing/library`.
3. **Synchronization**: install Syncthing-Fork (or official Syncthing) and sync the library folder to local storage.

**iOS**
1. No permission step. **Choose folder…** opens the Files app picker (`UIDocumentPickerViewController`). The app keeps a bookmark to the folder (`ios/App/App/ReadingHelperPlugins.swift`) and re-opens it on every launch, because the app's container path can change after an update.
2. The folder can live in the app's own space (Files → On My iPhone → Reading Helper; enabled via `UIFileSharingEnabled`) or in another app's folder that Files can see (e.g. a Syncthing client such as Möbius Sync).

---

## 3. Building the Android APK (User Machine)

> **Notice:** The current development container environment does **not** have the Android SDK or Gradle installed (`ANDROID_HOME` unset). Therefore, the APK build and JVM Gradle test were **not executed in this environment**.
>
> The native code (`RangeReader.java`, `RangeFilePlugin.java`, `AllFilesPlugin.java`, `MainActivity.java`, `AndroidManifest.xml`, and `RangeReaderTest.java`) is fully authored and synchronized into `android/`.

To build the APK on your host machine (with Android Studio / SDK and JDK 21):

```bash
cd apps/mobile

# Build web assets and sync to android/
npm install
npm run android:sync

# Build Debug APK
cd android
./gradlew assembleDebug

# Output APK:
# android/app/build/outputs/apk/debug/app-debug.apk

# Install to connected device via ADB:
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Run native JVM unit tests (RangeReaderTest):
./gradlew test
```

Or open the project in Android Studio:
```bash
npm run android:open
```

## 3b. Building the iOS App (needs a Mac with Xcode)

The Xcode project lives in `ios/` (Swift Package Manager, no CocoaPods). App-local plugins (`RangeFile`, `FolderPicker`) are in `ios/App/App/ReadingHelperPlugins.swift` and registered by `MainViewController` (set in `Main.storyboard`).

```bash
cd apps/mobile
npm install
npm run ios:sync   # build web assets and copy into ios/
npm run ios:open   # open in Xcode, pick your team under Signing & Capabilities, run on a device
```

A free Apple ID can install on your own device (re-sign every 7 days); the paid developer program is needed for TestFlight.

---

## 4. Performance Benchmarks

Measured on the 50-source, 5,000-card synthetic library with 4× CPU throttling under Pixel 7 dimensions (`perf-results/perf.json`):

| Metric | Result | Target | Status |
|---|---|---|---|
| **App Ready Time** (median) | 185 ms | < 1,500 ms | Passed |
| **P1 Swipe Latency** (commit to frame) | 16.5 ms (p95: 30.4 ms) | < 100 ms | Passed |
| **content.md Fetched (10 card swipes)** | 25.4 KB (26,019 bytes) | < 100 KB | Passed |
| **P2 Book Open Time** (15,000-line source) | 110 ms | < 700 ms | Passed |
| **P2 Book Scrolling Frame Rate** | 60 fps (0% > 50 ms) | 60 fps | Passed |
| **Search Latency** (keystroke to results) | 20.4 ms (p95: 30.9 ms) | < 50 ms | Passed |

---

## 5. Known Limitations & Environment Notes

- **Android**: `./gradlew test assembleDebug` passes (`RangeReaderTest`, `TreePathsTest`). Gradle needs a full JDK 21 (with `javac`), not just a JRE.
- **iOS**: the Swift plugins have not been compiled yet; building needs macOS + Xcode.
- **Folder picker**: not yet exercised on a physical device on either platform.
