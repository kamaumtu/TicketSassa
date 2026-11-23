package com.ticketsasa.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private final Uri origin = Uri.parse(BuildConfig.START_URL);
    private WebView web;
    private LinearLayout offline;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (isAppOrigin(target)) return false;
                if (!request.isForMainFrame()) return true;
                String scheme = target.getScheme();
                if (request.hasGesture() &&
                    ("https".equalsIgnoreCase(scheme) || "tel".equals(scheme) || "mailto".equals(scheme))) {
                    openExternal(target);
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) offline.setVisibility(View.VISIBLE);
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        offline = new LinearLayout(this);
        offline.setOrientation(LinearLayout.VERTICAL);
        offline.setGravity(Gravity.CENTER);
        offline.setPadding(32, 24, 32, 24);
        offline.setBackgroundColor(0xfff8fafc);
        TextView message = new TextView(this);
        message.setText("Could not connect to Ticketsassa. Check your internet connection and try again.");
        message.setGravity(Gravity.CENTER);
        offline.addView(message);
        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setOnClickListener(view -> loadApp());
        offline.addView(retry);
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) loadApp();
    }

    private static int httpsPort(Uri uri) {
        return uri.getPort() == -1 ? 443 : uri.getPort();
    }

    private boolean isAppOrigin(Uri target) {
        return "https".equalsIgnoreCase(target.getScheme()) && target.getUserInfo() == null &&
            origin.getHost().equalsIgnoreCase(target.getHost()) && httpsPort(origin) == httpsPort(target);
    }

    private void loadApp() {
        offline.setVisibility(View.GONE);
        web.loadUrl(BuildConfig.START_URL);
    }

    private void openExternal(Uri target) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, target));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "No app could open this link.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        web.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    public void onBackPressed() {
        if (offline.getVisibility() == View.VISIBLE) super.onBackPressed();
        else if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        ((FrameLayout) web.getParent()).removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
