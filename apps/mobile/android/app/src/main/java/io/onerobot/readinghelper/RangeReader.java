package io.onerobot.readinghelper;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.file.NoSuchFileException;

/** Pure part, no Android types, so it can be unit-tested on a plain JVM. */
public final class RangeReader {
    private RangeReader() {}

    /** Bytes [start, end) of the file. end is clamped to the file size. Throws NoSuchFileException if missing. */
    public static byte[] read(String path, long start, long end) throws Exception {
        File f = new File(path);
        if (!f.isFile()) {
            throw new NoSuchFileException(path);
        }
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
            long size = raf.length();
            long s = Math.max(0L, Math.min(start, size));
            long e = Math.max(s, Math.min(end, size));
            byte[] out = new byte[(int) (e - s)];
            raf.seek(s);
            raf.readFully(out);
            return out;
        }
    }
}
