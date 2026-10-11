package com.screenroom.app;

import android.app.Activity;
import android.media.projection.MediaProjection;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;
import org.webrtc.Camera2Enumerator;
import org.webrtc.DataChannel;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.DefaultVideoEncoderFactory;
import org.webrtc.EglBase;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.RtpSender;
import org.webrtc.ScreenCapturerAndroid;
import org.webrtc.SessionDescription;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

public class ScreenRoomClient {
    public interface Listener {
        void onStatus(String text); void onSharingChanged(boolean sharing); void onRemoteVideo(String peerId,String peerName,VideoTrack track); void onPeerLeft(String peerId); void onError(String message);
    }
    private final Activity activity; private final EglBase egl; private final Listener listener; private final Handler main=new Handler(Looper.getMainLooper());
    private final Map<String,Peer> peers=new HashMap<>(); private boolean closing=false; private WebSocket ws; private String myId,name,room,serverUrl; private PeerConnectionFactory factory; private VideoSource videoSource; private VideoTrack videoTrack; private ScreenCapturerAndroid capturer; private SurfaceTextureHelper textureHelper;
    private final PeerConnection.RTCConfiguration rtcConfig;
    private static class Peer { String id,name; PeerConnection pc; Peer(String i,String n,PeerConnection p){id=i;name=n;pc=p;} }

    public ScreenRoomClient(Activity a,EglBase e,Listener l){ activity=a; egl=e; listener=l; PeerConnection.IceServer s1=PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(); PeerConnection.IceServer s2=PeerConnection.IceServer.builder("stun:stun.cloudflare.com:3478").createIceServer(); rtcConfig=new PeerConnection.RTCConfiguration(Arrays.asList(s1,s2)); rtcConfig.sdpSemantics=PeerConnection.SdpSemantics.UNIFIED_PLAN; }

    public void connect(String server,String n,String r){ closing=false; serverUrl=server; name=n;room=r; if(factory==null) factory=PeerConnectionFactory.builder().setVideoEncoderFactory(new DefaultVideoEncoderFactory(egl.getEglBaseContext(),true,true)).setVideoDecoderFactory(new DefaultVideoDecoderFactory(egl.getEglBaseContext())).createPeerConnectionFactory(); String base=serverUrl.endsWith("/") ? serverUrl.substring(0,serverUrl.length()-1) : serverUrl; String wsUrl=base.replaceFirst("^https://","wss://").replaceFirst("^http://","ws://")+"/signal"; listener.onStatus("Conectando…"); OkHttpClient http=new OkHttpClient(); Request req=new Request.Builder().url(wsUrl).build(); ws=http.newWebSocket(req,new WebSocketListener(){@Override public void onOpen(WebSocket w, okhttp3.Response r){ws=w;send(json("type","join","room",room,"name",name));} @Override public void onMessage(WebSocket w,String text){handle(text);} @Override public void onClosing(WebSocket w,int c,String s){listener.onStatus("Reconectando…");} @Override public void onFailure(WebSocket w,Throwable t,okhttp3.Response r){listener.onError("Falha na conexão: "+t.getMessage());}}); }
    private JSONObject json(Object... kv){ JSONObject o=new JSONObject(); try{for(int i=0;i<kv.length;i+=2)o.put(String.valueOf(kv[i]),kv[i+1]);}catch(Exception ignored){} return o; }
    private void send(JSONObject o){if(ws!=null)ws.send(o.toString());}

    private void handle(String text){ try{JSONObject m=new JSONObject(text); String type=m.optString("type"); if(type.equals("joined")){myId=m.getString("id"); listener.onStatus("Conectado"); org.json.JSONArray list=m.getJSONArray("peers"); for(int index=0;index<list.length();index++){JSONObject p=list.getJSONObject(index); addPeer(p.getString("id"),p.optString("name","Convidado"));} } else if(type.equals("peer-joined")){JSONObject p=m.getJSONObject("peer");addPeer(p.getString("id"),p.optString("name","Convidado"));} else if(type.equals("peer-left")){String id=m.getString("id");removePeer(id);} else if(type.equals("offer")){onOffer(m);} else if(type.equals("answer")){Peer p=peers.get(m.getString("from"));if(p!=null)p.pc.setRemoteDescription(new SimpleSdpObserver(){public void onSetSuccess(){}},new SessionDescription(SessionDescription.Type.ANSWER,m.getJSONObject("answer").getString("sdp")));} else if(type.equals("ice")){Peer p=peers.get(m.getString("from"));if(p!=null){JSONObject c=m.optJSONObject("candidate");if(c!=null)p.pc.addIceCandidate(new IceCandidate(c.optString("sdpMid"),c.optInt("sdpMLineIndex"),c.optString("candidate")));}} else if(type.equals("error")){listener.onError(m.optString("message","Erro"));}}catch(Exception e){listener.onError("Sinalização inválida.");}}

    private void addPeer(String id,String n){if(id.equals(myId)||peers.containsKey(id))return; PeerConnection pc=createPc(id,n); peers.put(id,new Peer(id,n,pc)); if(videoTrack!=null) { pc.addTrack(videoTrack,Arrays.asList("screen")); createOffer(peers.get(id)); }}
    private PeerConnection createPc(String id,String peerName){PeerConnection pc=factory.createPeerConnection(rtcConfig,new PeerConnection.Observer(){public void onIceCandidate(IceCandidate c){send(json("type","ice","to",id,"candidate",json("candidate",c.sdp,"sdpMid",c.sdpMid,"sdpMLineIndex",c.sdpMLineIndex)));} public void onAddStream(MediaStream s){} public void onRemoveStream(MediaStream s){} public void onDataChannel(DataChannel d){} public void onRenegotiationNeeded(){} public void onSignalingChange(PeerConnection.SignalingState s){} public void onIceConnectionChange(PeerConnection.IceConnectionState s){} public void onIceConnectionReceivingChange(boolean b){} public void onIceGatheringChange(PeerConnection.IceGatheringState s){} public void onIceCandidatesRemoved(IceCandidate[] c){} public void onAddTrack(RtpReceiver r,MediaStream[] s){if(r.track() instanceof VideoTrack) listener.onRemoteVideo(id,peerName,(VideoTrack)r.track());} }); return pc;}
    private void createOffer(Peer p){MediaConstraints c=new MediaConstraints();p.pc.createOffer(new SimpleSdpObserver(){public void onCreateSuccess(SessionDescription d){p.pc.setLocalDescription(new SimpleSdpObserver(){public void onSetSuccess(){send(json("type","offer","to",p.id,"offer",json("type",d.type.canonicalForm(),"sdp",d.description)));}},d);}},c);}
    private void onOffer(JSONObject m)throws Exception{String id=m.getString("from");Peer p=peers.get(id);if(p==null){addPeer(id,"Convidado");p=peers.get(id);}final Peer target=p;JSONObject o=m.getJSONObject("offer");SessionDescription s=new SessionDescription(SessionDescription.Type.fromCanonicalForm(o.getString("type")),o.getString("sdp"));target.pc.setRemoteDescription(new SimpleSdpObserver(){public void onSetSuccess(){MediaConstraints c=new MediaConstraints();target.pc.createAnswer(new SimpleSdpObserver(){public void onCreateSuccess(SessionDescription a){target.pc.setLocalDescription(new SimpleSdpObserver(){public void onSetSuccess(){send(json("type","answer","to",id,"answer",json("type",a.type.canonicalForm(),"sdp",a.description)));}},a);}},c);}},s);}

    public void startSharing(int resultCode,Intent data){if(videoTrack!=null)return; try{videoSource=factory.createVideoSource(true); capturer=new ScreenCapturerAndroid(data,new MediaProjection.Callback(){@Override public void onStop(){stopSharing();}}); textureHelper=SurfaceTextureHelper.create("ScreenCapture",egl.getEglBaseContext());capturer.initialize(textureHelper,activity,videoSource.getCapturerObserver());capturer.startCapture(1920,1080,30);videoTrack=factory.createVideoTrack("screen-video",videoSource); for(Peer p:peers.values()){p.pc.addTrack(videoTrack,Arrays.asList("screen"));createOffer(p);} send(json("type","share-state","sharing",true));listener.onSharingChanged(true);listener.onStatus("Transmitindo tela");}catch(Exception e){listener.onError("Não foi possível iniciar a captura: "+e.getMessage());}}
    public void stopSharing(){if(videoTrack==null)return;try{capturer.stopCapture();}catch(Exception ignored){}try{capturer.dispose();}catch(Exception ignored){}try{textureHelper.dispose();}catch(Exception ignored){}videoTrack.dispose();videoTrack=null;if(videoSource!=null){videoSource.dispose();videoSource=null;}for(Peer p:peers.values()){p.pc.close();}peers.clear();send(json("type","share-state","sharing",false));listener.onSharingChanged(false);listener.onStatus("Reconectando…"); if(ws!=null){ws.close(1000,"share stopped"); ws=null;} if(!closing) main.postDelayed(() -> connect(serverUrl,name,room), 250);}
    private void removePeer(String id){Peer p=peers.remove(id);if(p!=null)p.pc.close();listener.onPeerLeft(id);}
    public void close(){closing=true;try{if(videoTrack!=null) stopSharing();}catch(Exception ignored){}for(Peer p:peers.values())p.pc.close();peers.clear();if(ws!=null)ws.close(1000,"bye");if(factory!=null)factory.dispose();}
    private static class SimpleSdpObserver implements org.webrtc.SdpObserver {public void onCreateSuccess(SessionDescription s){}public void onSetSuccess(){}public void onCreateFailure(String s){}public void onSetFailure(String s){}}
}
