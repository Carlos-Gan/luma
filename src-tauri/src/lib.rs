// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod image;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn decode_heic_thumbnail(
    app: tauri::AppHandle,
    image_base64: String,
    max_side: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        image::decode_heic_thumbnail(&app, &image_base64, max_side)
    })
    .await
    .map_err(|error| format!("No se pudo iniciar la decodificación HEIC: {error}"))?
}

#[tauri::command]
async fn convert_image(image_base64: String, source_extension: String, target_format: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        image::convert_image(&image_base64, &source_extension, &target_format)
    })
    .await
    .map_err(|error| format!("No se pudo iniciar la conversión: {error}"))?
}

#[tauri::command]
async fn heic_dimensions(image_base64: String) -> Result<(u32, u32), String> {
    tauri::async_runtime::spawn_blocking(move || image::heic_dimensions(&image_base64))
        .await
        .map_err(|error| format!("No se pudo leer la resolución HEIC: {error}"))?
}

#[tauri::command]
async fn image_location(image_base64: String) -> Result<Option<image::PhotoLocation>, String> {
    tauri::async_runtime::spawn_blocking(move || image::read_photo_location(&image_base64))
        .await
        .map_err(|error| format!("No se pudieron leer las coordenadas GPS: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, decode_heic_thumbnail, convert_image, heic_dimensions, image_location])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
