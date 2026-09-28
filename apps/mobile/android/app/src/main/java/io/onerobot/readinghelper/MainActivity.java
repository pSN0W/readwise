package io.onerobot.readinghelper;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RangeFilePlugin.class);
        registerPlugin(AllFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
