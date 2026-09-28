package io.onerobot.readinghelper;

import org.junit.Test;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.NoSuchFileException;
import static org.junit.Assert.*;

public class RangeReaderTest {

    @Test
    public void testReadRange() throws Exception {
        File temp = File.createTempFile("rangereader", ".txt");
        temp.deleteOnExit();
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write("a·b\nline2\n".getBytes(StandardCharsets.UTF_8));
        }

        // [0, 5) -> "a·b\n" ('·' is 2 bytes in UTF-8)
        byte[] bytes = RangeReader.read(temp.getAbsolutePath(), 0, 5);
        assertEquals("a·b\n", new String(bytes, StandardCharsets.UTF_8));

        // Clamped past the end
        long len = temp.length();
        byte[] clamped = RangeReader.read(temp.getAbsolutePath(), 0, len + 100);
        assertEquals("a·b\nline2\n", new String(clamped, StandardCharsets.UTF_8));
    }

    @Test(expected = NoSuchFileException.class)
    public void testMissingFileThrows() throws Exception {
        RangeReader.read("/nonexistent/file/path/here.txt", 0, 10);
    }
}
