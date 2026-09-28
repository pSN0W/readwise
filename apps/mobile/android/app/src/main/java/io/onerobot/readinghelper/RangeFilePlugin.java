package io.onerobot.readinghelper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.nio.file.NoSuchFileException;

@CapacitorPlugin(name = "RangeFile")
public class RangeFilePlugin extends Plugin {

    private Long getLongOrInt(PluginCall call, String name) {
        Long val = call.getLong(name);
        if (val != null) return val;
        Integer i = call.getInt(name);
        if (i != null) return i.longValue();
        return null;
    }

    @PluginMethod
    public void read(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("path is required", "BAD_ARGS");
            return;
        }
        Long start = getLongOrInt(call, "start");
        if (start == null) {
            call.reject("start is required", "BAD_ARGS");
            return;
        }
        Long end = getLongOrInt(call, "end");
        if (end == null) {
            call.reject("end is required", "BAD_ARGS");
            return;
        }
        if (end - start > 16L * 1024 * 1024) {
            call.reject("range too large (> 16 MB)", "TOO_LARGE");
            return;
        }
        final long s = start;
        final long e = end;
        bridge.execute(() -> {
            try {
                byte[] bytes = RangeReader.read(path, s, e);
                JSObject ret = new JSObject();
                ret.put("data", new String(bytes, StandardCharsets.UTF_8));
                call.resolve(ret);
            } catch (NoSuchFileException ex) {
                call.reject("not found: " + path, "NOT_FOUND");
            } catch (Exception ex) {
                call.reject(ex.getMessage() != null ? ex.getMessage() : "read failed", "IO_ERROR", ex);
            }
        });
    }
}
