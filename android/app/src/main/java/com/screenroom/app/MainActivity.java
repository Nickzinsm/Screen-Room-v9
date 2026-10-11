package com.screenroom.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.ViewGroup;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.webrtc.EglBase;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.SurfaceViewRenderer;

import java.util.HashMap;
import java.util.Map;

public class MainActivity extends AppCompatActivity implements ScreenRoomClient.Listener {
    private static final int REQ_CAPTURE = 1001;
    private static final int REQ_NOTIFICATIONS = 1002;
    private EglBase eglBase;
    private ScreenRoomClient client;
    private LinearLayout root, loginPanel, roomPanel, remoteList;
    private EditText nameInput, roomInput, serverInput;
    private TextView status, roomCode;
    private Button shareButton, stopButton, themeButton;
    private boolean night = false;
    private final Map<String, SurfaceViewRenderer> remoteViews = new HashMap<>();

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(android.graphics.Color.rgb(6,62,86));
        getWindow().setNavigationBarColor(android.graphics.Color.rgb(6,62,86));
        eglBase = EglBase.create();
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(this).createInitializationOptions());
        buildUi();
        if (android.os.Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
        }
    }

    private TextView label(String text) {
        TextView t = new TextView(this);
        t.setText(text); t.setTextSize(14); t.setTypeface(android.graphics.Typeface.create("sans-serif-rounded", android.graphics.Typeface.BOLD));
        t.setTextColor(night ? Color.rgb(190,246,245) : Color.rgb(24,92,111));
        t.setPadding(6,14,6,6); return t;
    }
    private GradientDrawable bg(int top, int bottom, int stroke) {
        GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{top,bottom});
        g.setCornerRadius(22f); g.setStroke(2, stroke); return g;
    }
    private Button btn(String text) {
        Button b = new Button(this); b.setText(text); b.setAllCaps(false); b.setTextSize(14);
        b.setTypeface(android.graphics.Typeface.create("sans-serif-rounded", android.graphics.Typeface.BOLD));
        b.setPadding(12,0,12,0); b.setMinHeight(56); b.setStateListAnimator(null);
        b.setTextColor(night ? Color.WHITE : Color.rgb(16,76,95));
        b.setBackground(bg(night?Color.rgb(28,86,106):Color.rgb(255,255,255), night?Color.rgb(11,53,72):Color.rgb(200,249,249), night?Color.rgb(100,222,229):Color.rgb(101,205,213)));
        return b;
    }

    private void buildUi() {
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(22,18,22,18); root.setBackgroundColor(Color.rgb(190,239,255));
        LinearLayout top = new LinearLayout(this); top.setGravity(Gravity.CENTER_VERTICAL); top.setPadding(0,0,0,12);
        TextView title = new TextView(this); title.setText("◈ Screen Room"); title.setTextSize(23); title.setTextColor(Color.rgb(15,102,130)); title.setTypeface(android.graphics.Typeface.create("sans-serif-rounded", android.graphics.Typeface.BOLD));
        top.addView(title, new LinearLayout.LayoutParams(0,58,1));
        themeButton = btn("☀️"); top.addView(themeButton, new LinearLayout.LayoutParams(58,58)); themeButton.setOnClickListener(v -> { night=!night; applyTheme(); });
        root.addView(top);

        loginPanel = new LinearLayout(this); loginPanel.setOrientation(LinearLayout.VERTICAL); loginPanel.setPadding(24,24,24,24); loginPanel.setBackground(bg(0xF5FFFFFF,0xDDF0FFFF,0xFFFFFFFF));
        TextView welcome = new TextView(this); welcome.setText("Compartilhe a tela do Android"); welcome.setTextSize(28); welcome.setTextColor(Color.rgb(18,82,104)); welcome.setTypeface(android.graphics.Typeface.create("sans-serif-rounded", android.graphics.Typeface.BOLD)); loginPanel.addView(welcome);
        TextView desc = new TextView(this); desc.setText("Entre na mesma sala do PC e toque em Compartilhar tela. O áudio do microfone não é enviado pelo app."); desc.setTextSize(14); desc.setTextColor(Color.rgb(54,101,116)); loginPanel.addView(desc);
        loginPanel.addView(label("Seu nome")); nameInput = new EditText(this); nameInput.setHint("Ex.: GHOSTIN"); nameInput.setSingleLine(); loginPanel.addView(nameInput, new LinearLayout.LayoutParams(-1,58));
        loginPanel.addView(label("Servidor (HTTPS)")); serverInput = new EditText(this); serverInput.setText(ServerConfig.WEB_BASE_URL); serverInput.setSingleLine(); loginPanel.addView(serverInput, new LinearLayout.LayoutParams(-1,58));
        loginPanel.addView(label("Código da sala")); roomInput = new EditText(this); roomInput.setHint("Ex.: GAMING-123"); roomInput.setSingleLine(); roomInput.setAllCaps(true); loginPanel.addView(roomInput, new LinearLayout.LayoutParams(-1,58));
        Button join = btn("Entrar na sala"); loginPanel.addView(join, new LinearLayout.LayoutParams(-1,58)); join.setOnClickListener(v -> join());
        root.addView(loginPanel, new LinearLayout.LayoutParams(-1,-2));

        roomPanel = new LinearLayout(this); roomPanel.setOrientation(LinearLayout.VERTICAL); roomPanel.setPadding(8,8,8,8); roomPanel.setVisibility(View.GONE); roomPanel.setBackground(bg(0xE8FFFFFF,0xD4E5FCFF,0xFFFFFFFF));
        LinearLayout info = new LinearLayout(this); info.setGravity(Gravity.CENTER_VERTICAL);
        roomCode = new TextView(this); roomCode.setTextSize(16); roomCode.setTypeface(null,1); roomCode.setTextColor(android.graphics.Color.rgb(20,95,115)); info.addView(roomCode,new LinearLayout.LayoutParams(0,52,1));
        status = new TextView(this); status.setText("Desconectado"); status.setTextSize(12); info.addView(status); roomPanel.addView(info);
        ScrollView scroll = new ScrollView(this); remoteList = new LinearLayout(this); remoteList.setOrientation(LinearLayout.VERTICAL); scroll.addView(remoteList); roomPanel.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout actions = new LinearLayout(this); actions.setGravity(Gravity.CENTER); actions.setPadding(0,10,0,0);
        shareButton = btn("🖥️ Compartilhar tela"); stopButton = btn("■ Parar"); stopButton.setEnabled(false); actions.addView(shareButton,new LinearLayout.LayoutParams(0,58,1)); actions.addView(stopButton,new LinearLayout.LayoutParams(0,58,1));
        shareButton.setOnClickListener(v -> requestCapture()); stopButton.setOnClickListener(v -> client.stopSharing()); roomPanel.addView(actions);
        root.addView(roomPanel,new LinearLayout.LayoutParams(-1,0,1));
        setContentView(root); applyTheme();
    }

    private void applyTheme() {
        int bg = night ? Color.rgb(6,28,49) : Color.rgb(188,238,255);
        root.setBackgroundColor(bg);
        themeButton.setText(night ? "☀️" : "🌙");
        themeButton.setTextColor(Color.WHITE);
        themeButton.setBackground(bg(night?Color.rgb(28,86,106):Color.rgb(255,255,255), night?Color.rgb(9,55,73):Color.rgb(210,250,250), night?Color.rgb(101,228,231):Color.rgb(100,206,214)));
        if (loginPanel != null) loginPanel.setBackground(bg(night?0xF0173E56:0xF5FFFFFF, night?0xE80A2941:0xDDE7FCFF, night?0x77BDF7FF:0xFFFFFFFF));
        if (roomPanel != null) roomPanel.setBackground(bg(night?0xEE11384F:0xE8FFFFFF, night?0xE60A2E46:0xD4E5FCFF, night?0x66BDF5FF:0xFFFFFFFF));
        updateTextColors();
    }

    private void updateTextColors() {
        int main = night ? Color.rgb(226,252,255) : Color.rgb(18,82,104);
        int secondary = night ? Color.rgb(166,214,224) : Color.rgb(54,101,116);
        if (loginPanel != null && loginPanel.getChildCount() > 1) {
            for (int i=0;i<loginPanel.getChildCount();i++) {
                View v=loginPanel.getChildAt(i); if(v instanceof TextView){ ((TextView)v).setTextColor(i<=1?main:secondary); }
            }
        }
        if (roomCode != null) roomCode.setTextColor(main);
        if (status != null) status.setTextColor(secondary);
    }

    private void join() {
        String name = nameInput.getText().toString().trim(); if(name.isEmpty()) name="Convidado";
        String room = roomInput.getText().toString().trim().toUpperCase().replaceAll("[^A-Z0-9-]", "");
        if(room.isEmpty()){ toast("Digite o código da sala."); return; }
        loginPanel.setVisibility(View.GONE); roomPanel.setVisibility(View.VISIBLE); roomCode.setText("SALA  " + room); status.setText("Conectando…");
        String server = serverInput.getText().toString().trim(); if(server.isEmpty() || server.contains("SEU-ENDERECO")){ toast("Informe o endereço HTTPS do seu Screen Room."); return; } client = new ScreenRoomClient(this, eglBase, this); client.connect(server, name, room);
    }

    private void requestCapture() {
        MediaProjectionManager mgr = (MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE);
        startActivityForResult(mgr.createScreenCaptureIntent(), REQ_CAPTURE);
    }

    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){ super.onActivityResult(requestCode,resultCode,data); if(requestCode==REQ_CAPTURE && resultCode==Activity.RESULT_OK && data!=null){ androidx.core.content.ContextCompat.startForegroundService(this,new Intent(this,ScreenCaptureForegroundService.class)); client.startSharing(resultCode,data); } }

    @Override public void onStatus(String text){ runOnUiThread(() -> status.setText(text)); }
    @Override public void onSharingChanged(boolean sharing){ runOnUiThread(() -> { shareButton.setEnabled(!sharing); stopButton.setEnabled(sharing); if(!sharing) stopService(new Intent(this,ScreenCaptureForegroundService.class)); }); }
    @Override public void onRemoteVideo(String peerId,String peerName, org.webrtc.VideoTrack track){
        runOnUiThread(() -> {
            if(remoteViews.containsKey(peerId)) return;
            SurfaceViewRenderer view = new SurfaceViewRenderer(this); view.init(eglBase.getEglBaseContext(), null); view.setEnableHardwareScaler(true); view.setMirror(false); track.addSink(view); remoteViews.put(peerId,view);
            TextView label = new TextView(this); label.setText(peerName + " • transmissão"); label.setTextColor(night?Color.rgb(235,255,255):Color.rgb(17,78,95)); label.setTypeface(android.graphics.Typeface.create("sans-serif-rounded", android.graphics.Typeface.BOLD)); label.setTextSize(13); label.setPadding(4,8,4,5);
            remoteList.addView(label,new LinearLayout.LayoutParams(-1,32)); remoteList.addView(view,new LinearLayout.LayoutParams(-1,260));
        });
    }
    @Override public void onPeerLeft(String peerId){ runOnUiThread(() -> { SurfaceViewRenderer v=remoteViews.remove(peerId); if(v!=null){ v.release(); remoteList.removeView(v); } }); }
    @Override public void onError(String message){ runOnUiThread(() -> toast(message)); }
    private void toast(String s){ Toast.makeText(this,s,Toast.LENGTH_SHORT).show(); }
    @Override protected void onDestroy(){ if(client!=null) client.close(); if(eglBase!=null) eglBase.release(); super.onDestroy(); }
}
