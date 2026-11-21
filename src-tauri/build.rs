fn main() {
    // Declaring the app's commands generates allow-open-clipper / allow-clip
    // permissions, so each window gets only the commands its capability grants.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["open_clipper", "clip"])))
        .expect("failed to run the Tauri build script");
}
