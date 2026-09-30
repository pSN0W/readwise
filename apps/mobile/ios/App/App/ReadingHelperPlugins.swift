import Capacitor
import UIKit
import UniformTypeIdentifiers

/// Bridge view controller (set in Main.storyboard) that registers the app's own plugins.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RangeFilePlugin())
        bridge?.registerPluginInstance(FolderPickerPlugin())
    }
}

/// RangeFile: read bytes [start, end) of a file as UTF-8. Same contract as android/.../RangeFilePlugin.java.
@objc(RangeFilePlugin)
public class RangeFilePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RangeFilePlugin"
    public let jsName = "RangeFile"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    @objc func read(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { return call.reject("path is required", "BAD_ARGS") }
        guard let start = call.getDouble("start") else { return call.reject("start is required", "BAD_ARGS") }
        guard let end = call.getDouble("end") else { return call.reject("end is required", "BAD_ARGS") }
        if end - start > 16 * 1024 * 1024 { return call.reject("range too large (> 16 MB)", "TOO_LARGE") }
        DispatchQueue.global(qos: .userInitiated).async {
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir), !isDir.boolValue else {
                return call.reject("not found: \(path)", "NOT_FOUND")
            }
            do {
                let h = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
                defer { try? h.close() }
                let size = try h.seekToEnd()
                let s = min(UInt64(max(0, start)), size)
                let e = max(s, min(UInt64(max(0, end)), size))
                try h.seek(toOffset: s)
                let data = try h.read(upToCount: Int(e - s)) ?? Data()
                call.resolve(["data": String(decoding: data, as: UTF8.self)])
            } catch {
                call.reject(error.localizedDescription, "IO_ERROR", error)
            }
        }
    }
}

/// FolderPicker: pick a folder in the Files app and keep access to it across launches (bookmark in UserDefaults).
@objc(FolderPickerPlugin)
public class FolderPickerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FolderPickerPlugin"
    public let jsName = "FolderPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    private let bookmarkKey = "rh.libraryBookmark"
    private var pending: CAPPluginCall?
    /// The folder we hold security-scoped access to, if any.
    private var current: URL?

    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.pending = call
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    /// Resolves { path } for the saved folder (the app's container path can change between installs), or {} if none.
    @objc func restore(_ call: CAPPluginCall) {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return call.resolve([:]) }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
            return call.resolve([:])
        }
        hold(url)
        if stale { save(url) }
        call.resolve(["path": url.path])
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pending else { return }
        pending = nil
        guard let url = urls.first else { return call.reject("cancelled", "CANCELLED") }
        hold(url)
        guard save(url) else { return call.reject("Cannot keep access to this folder.", "NO_ACCESS") }
        call.resolve(["path": url.path])
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.reject("cancelled", "CANCELLED")
        pending = nil
    }

    /// Folders inside our own container need no scope: startAccessing returns false there and reads still work.
    private func hold(_ url: URL) {
        current?.stopAccessingSecurityScopedResource()
        current = url.startAccessingSecurityScopedResource() ? url : nil
    }

    @discardableResult
    private func save(_ url: URL) -> Bool {
        guard let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) else { return false }
        UserDefaults.standard.set(data, forKey: bookmarkKey)
        return true
    }
}
