package io.onerobot.readinghelper;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Opens the system folder picker and returns the folder as an absolute path (read later with All files access). */
@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data != null ? data.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.reject("cancelled", "CANCELLED");
            return;
        }
        String path = TreePaths.toPath(uri.getAuthority(), DocumentsContract.getTreeDocumentId(uri),
                Environment.getExternalStorageDirectory().getAbsolutePath());
        if (path == null) {
            call.reject("Pick a folder on this phone's storage (not a cloud app).", "UNSUPPORTED");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("path", path);
        call.resolve(ret);
    }
}
