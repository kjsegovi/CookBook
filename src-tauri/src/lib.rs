// CookBook for macOS: the same web app in a native window, plus a recipe
// browser with a "Save to CookBook" button and cookbook:// links (Reminders
// sync returns here; cookbook://import?url=… opens the import dialog).
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;

// Injected into pages opened in the recipe browser. It can only send the page
// address back; CookBook then fetches and imports it like a shared link.
const CLIP_SCRIPT: &str = r#"(() => {
  if (window.top !== window) return;
  const add = () => {
    if (document.getElementById('__cookbook_clip')) return;
    const b = document.createElement('button');
    b.id = '__cookbook_clip';
    b.textContent = 'Save to CookBook';
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:12px 18px;border-radius:999px;border:0;background:#35664b;color:#fff;font:600 15px -apple-system,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer';
    b.onclick = () => window.__TAURI_INTERNALS__.invoke('clip', { url: location.href });
    document.documentElement.appendChild(b);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();"#;

fn web_url(value: &str) -> Result<Url, String> {
    let url: Url = value.parse().map_err(|_| "Enter a web address.".to_string())?;
    if url.scheme() == "http" || url.scheme() == "https" { Ok(url) } else { Err("Only web pages can be opened.".into()) }
}

fn open_import(app: &AppHandle, link: &str) {
    if let Some(main) = app.get_webview_window("main") {
        let js = format!("location.href = location.origin + location.pathname + '?share-url=' + encodeURIComponent({})", serde_json::to_string(link).unwrap_or_default());
        let _ = main.eval(&js);
        let _ = main.set_focus();
    }
}

fn open_deep_link(app: &AppHandle, url: &Url) {
    if let Some(fragment) = url.fragment() {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.eval(&format!("location.hash = {}", serde_json::to_string(&format!("#{fragment}")).unwrap_or_default()));
            let _ = main.set_focus();
        }
    } else if let Some((_, link)) = url.query_pairs().find(|(key, _)| key == "url") {
        if web_url(&link).is_ok() { open_import(app, &link); }
    }
}

#[tauri::command]
fn open_clipper(app: AppHandle, url: String) -> Result<(), String> {
    let url = web_url(&url)?;
    if let Some(window) = app.get_webview_window("clipper") {
        window.navigate(url).map_err(|e| e.to_string())?;
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "clipper", WebviewUrl::External(url))
        .title("Find a recipe · CookBook")
        .inner_size(1100.0, 820.0)
        .initialization_script(CLIP_SCRIPT)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn clip(app: AppHandle, url: String) -> Result<(), String> {
    let url = web_url(&url)?;
    open_import(&app, url.as_str());
    if let Some(window) = app.get_webview_window("clipper") { let _ = window.close(); }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![open_clipper, clip])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() { open_deep_link(&handle, &url); }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CookBook");
}
