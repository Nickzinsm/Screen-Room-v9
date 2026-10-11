package com.screenroom.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class ScreenCaptureForegroundService extends Service {
    private static final String CHANNEL = "screen_capture";
    private static final int ID = 4101;
    @Override public void onCreate(){ super.onCreate(); if(Build.VERSION.SDK_INT>=26){ NotificationChannel c=new NotificationChannel(CHANNEL,"Screen Room",NotificationManager.IMPORTANCE_LOW); getSystemService(NotificationManager.class).createNotificationChannel(c); } }
    @Override public int onStartCommand(Intent intent,int flags,int startId){ Notification n=new NotificationCompat.Builder(this,CHANNEL).setSmallIcon(com.screenroom.app.R.drawable.ic_launcher).setContentTitle("Screen Room").setContentText("Transmitindo a tela do celular").setOngoing(true).build(); if(Build.VERSION.SDK_INT>=29) startForeground(ID,n,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION); else startForeground(ID,n); return START_NOT_STICKY; }
    @Override public void onDestroy(){ stopForeground(true); super.onDestroy(); }
    @Nullable @Override public IBinder onBind(Intent intent){ return null; }
}
