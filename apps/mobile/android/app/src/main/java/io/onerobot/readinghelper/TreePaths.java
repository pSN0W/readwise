package io.onerobot.readinghelper;

/** Pure part of FolderPickerPlugin, no Android types, so it can be unit-tested on a plain JVM. */
public final class TreePaths {
    private TreePaths() {}

    static final String EXTERNAL = "com.android.externalstorage.documents";
    static final String DOWNLOADS = "com.android.providers.downloads.documents";

    /**
     * Absolute path for a folder picked with ACTION_OPEN_DOCUMENT_TREE, or null if it is not a plain folder
     * (cloud apps, Drive, other providers). The app then reads it by path with "All files access".
     * docId looks like "primary:Syncthing/library" or "1A2B-3C4D:library" (SD card).
     */
    public static String toPath(String authority, String docId, String primaryRoot) {
        if (docId == null) return null;
        if (DOWNLOADS.equals(authority) && docId.startsWith("raw:")) return docId.substring(4);
        if (!EXTERNAL.equals(authority)) return null;
        int i = docId.indexOf(':');
        if (i < 0) return null;
        String vol = docId.substring(0, i);
        String rel = docId.substring(i + 1).replaceAll("/+$", "");
        String base;
        if ("primary".equalsIgnoreCase(vol)) base = primaryRoot;
        else if ("home".equalsIgnoreCase(vol)) base = primaryRoot + "/Documents";
        else base = "/storage/" + vol;
        return rel.isEmpty() ? base : base + "/" + rel;
    }
}
