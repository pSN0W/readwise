package io.onerobot.readinghelper;

import org.junit.Test;
import static org.junit.Assert.*;

public class TreePathsTest {
    private static final String ROOT = "/storage/emulated/0";

    @Test
    public void testPrimaryStorage() {
        assertEquals("/storage/emulated/0/Syncthing/library", TreePaths.toPath(TreePaths.EXTERNAL, "primary:Syncthing/library", ROOT));
        assertEquals("/storage/emulated/0/Syncthing/library", TreePaths.toPath(TreePaths.EXTERNAL, "primary:Syncthing/library/", ROOT));
        assertEquals("/storage/emulated/0", TreePaths.toPath(TreePaths.EXTERNAL, "primary:", ROOT));
    }

    @Test
    public void testOtherVolumes() {
        assertEquals("/storage/1A2B-3C4D/library", TreePaths.toPath(TreePaths.EXTERNAL, "1A2B-3C4D:library", ROOT));
        assertEquals("/storage/emulated/0/Documents/library", TreePaths.toPath(TreePaths.EXTERNAL, "home:library", ROOT));
        assertEquals("/storage/emulated/0/Download/library", TreePaths.toPath(TreePaths.DOWNLOADS, "raw:/storage/emulated/0/Download/library", ROOT));
    }

    @Test
    public void testUnsupported() {
        assertNull(TreePaths.toPath("com.google.android.apps.docs.storage", "abc", ROOT));
        assertNull(TreePaths.toPath(TreePaths.DOWNLOADS, "msd:12", ROOT));
        assertNull(TreePaths.toPath(TreePaths.EXTERNAL, null, ROOT));
        assertNull(TreePaths.toPath(TreePaths.EXTERNAL, "nocolon", ROOT));
    }
}
