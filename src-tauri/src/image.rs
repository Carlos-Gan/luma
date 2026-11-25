use std::fs;
use std::io::Cursor;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use image_rs::{DynamicImage, ImageFormat, RgbaImage, metadata::Orientation};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use serde::Serialize;

const MAX_SOURCE_BYTES: usize = 80 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 64_000_000;
const MAX_THUMBNAIL_SIDE: u32 = 4096;
const CACHE_LIMIT_BYTES: u64 = 512 * 1024 * 1024;
static CACHE_WRITE_COUNT: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Copy, Serialize)]
pub struct PhotoLocation {
    latitude: f64,
    longitude: f64,
}

pub fn read_photo_location(image_base64: &str) -> Result<Option<PhotoLocation>, String> {
    if image_base64.len() > (MAX_SOURCE_BYTES * 4 / 3) + 8 {
        return Err("El archivo supera el límite de 80 MB.".into());
    }
    let source = BASE64.decode(image_base64).map_err(|_| "El archivo no contiene datos válidos.".to_string())?;
    if source.len() > MAX_SOURCE_BYTES { return Err("El archivo supera el límite de 80 MB.".into()); }
    let exif = match exif::Reader::new().read_from_container(&mut BufReader::new(Cursor::new(source))) {
        Ok(exif) => exif,
        Err(_) => return Ok(None),
    };
    let latitude = gps_coordinate(&exif, exif::Tag::GPSLatitude, exif::Tag::GPSLatitudeRef, b"N", b"S");
    let longitude = gps_coordinate(&exif, exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef, b"E", b"W");
    match (latitude, longitude) {
        (Some(latitude), Some(longitude)) => Ok(Some(PhotoLocation { latitude, longitude })),
        _ => Ok(None),
    }
}

fn gps_coordinate(exif: &exif::Exif, value_tag: exif::Tag, ref_tag: exif::Tag, positive_ref: &[u8], negative_ref: &[u8]) -> Option<f64> {
    let field = exif.get_field(value_tag, exif::In::PRIMARY)?;
    let exif::Value::Rational(parts) = &field.value else { return None; };
    if parts.len() < 3 { return None; }
    let degrees = rational_to_f64(parts[0]);
    let minutes = rational_to_f64(parts[1]);
    let seconds = rational_to_f64(parts[2]);
    let reference = exif.get_field(ref_tag, exif::In::PRIMARY)?;
    let exif::Value::Ascii(values) = &reference.value else { return None; };
    let direction = values.first()?.first()?;
    let sign = if direction == positive_ref.first()? { 1.0 } else if direction == negative_ref.first()? { -1.0 } else { return None; };
    let coordinate = sign * (degrees + minutes / 60.0 + seconds / 3600.0);
    coordinate.is_finite().then_some(coordinate)
}

fn rational_to_f64(value: exif::Rational) -> f64 {
    if value.denom == 0 { 0.0 } else { f64::from(value.num) / f64::from(value.denom) }
}

fn read_image_orientation(source: &[u8]) -> Option<Orientation> {
    let exif = exif::Reader::new()
        .read_from_container(&mut BufReader::new(Cursor::new(source)))
        .ok()?;
    let value = exif
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)?
        .value
        .get_uint(0)?;
    Orientation::from_exif(u8::try_from(value).ok()?)
}

fn match_display_dimensions(
    image: &mut DynamicImage,
    width: u32,
    height: u32,
    orientation: Option<Orientation>,
) -> Result<(), String> {
    if (image.width(), image.height()) != (width, height) {
        if let Some(orientation) = orientation {
            image.apply_orientation(orientation);
        }
    }
    if (image.width(), image.height()) != (width, height) {
        return Err("La orientación HEIC no coincide con las dimensiones declaradas.".into());
    }
    Ok(())
}

pub fn decode_heic_thumbnail(
    app: &AppHandle,
    image_base64: &str,
    max_side: u32,
) -> Result<String, String> {
    if max_side == 0 || max_side > MAX_THUMBNAIL_SIDE {
        return Err(format!(
            "El tamaño de miniatura debe estar entre 1 y {MAX_THUMBNAIL_SIDE} píxeles."
        ));
    }

    if image_base64.len() > (MAX_SOURCE_BYTES * 4 / 3) + 8 {
        return Err("El archivo HEIC supera el límite de 80 MB.".into());
    }

    let source = BASE64
        .decode(image_base64)
        .map_err(|_| "El archivo HEIC no contiene datos válidos.".to_string())?;
    if source.len() > MAX_SOURCE_BYTES {
        return Err("El archivo HEIC supera el límite de 80 MB.".into());
    }

    let cache_dir = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|path| path.join("thumbnails").join("heic"));
    let cache_path = cache_dir.as_ref().map(|directory| {
        let digest = Sha256::digest(&source);
        directory.join(format!("{digest:x}-{max_side}-v2.jpg"))
    });

    if let Some(path) = &cache_path {
        if let Ok(cached) = fs::read(path) {
            touch_cache_file(path);
            return Ok(BASE64.encode(cached));
        }
    }

    let metadata = heif_oxide::read_metadata(&source)
        .map_err(|error| format!("No se pudo leer el encabezado HEIC: {error}"))?;
    let pixel_count = (metadata.width as u64)
        .checked_mul(metadata.height as u64)
        .ok_or_else(|| "La resolución HEIC no es válida.".to_string())?;
    if pixel_count > MAX_IMAGE_PIXELS {
        return Err("La imagen supera el límite de 64 megapíxeles.".into());
    }

    let decoded = heif_oxide::decode_bytes(&source)
        .map_err(|error| format!("No se pudo decodificar la imagen HEIC: {error}"))?;
    let rgba = RgbaImage::from_raw(decoded.width, decoded.height, decoded.to_rgba8())
        .ok_or_else(|| "La imagen HEIC contiene datos de píxeles incompletos.".to_string())?;
    let mut image = DynamicImage::ImageRgba8(rgba);
    match_display_dimensions(
        &mut image,
        metadata.width,
        metadata.height,
        read_image_orientation(&source),
    )?;

    let thumbnail = image.thumbnail(max_side, max_side).to_rgb8();
    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(thumbnail)
        .write_to(&mut output, ImageFormat::Jpeg)
        .map_err(|error| format!("No se pudo crear la miniatura HEIC: {error}"))?;
    let thumbnail_bytes = output.into_inner();

    if let Some(path) = cache_path {
        write_cache_file(&path, &thumbnail_bytes);
        if CACHE_WRITE_COUNT.fetch_add(1, Ordering::Relaxed) % 32 == 31 {
            if let Some(directory) = path.parent() {
                prune_cache(directory);
            }
        }
    }

    Ok(BASE64.encode(thumbnail_bytes))
}

pub fn convert_image(image_base64: &str, source_extension: &str, target_format: &str) -> Result<String, String> {
    if image_base64.len() > (MAX_SOURCE_BYTES * 4 / 3) + 8 {
        return Err("El archivo supera el límite de 80 MB.".into());
    }
    let source = BASE64.decode(image_base64).map_err(|_| "El archivo no contiene datos válidos.".to_string())?;
    if source.len() > MAX_SOURCE_BYTES { return Err("El archivo supera el límite de 80 MB.".into()); }
    let image = if matches!(source_extension, "heic" | "heif") {
        let metadata = heif_oxide::read_metadata(&source).map_err(|error| format!("No se pudo leer el archivo HEIC: {error}"))?;
        let pixels = (metadata.width as u64).checked_mul(metadata.height as u64).ok_or_else(|| "La resolución no es válida.".to_string())?;
        if pixels > MAX_IMAGE_PIXELS { return Err("La imagen supera el límite de 64 megapíxeles.".into()); }
        let decoded = heif_oxide::decode_bytes(&source).map_err(|error| format!("No se pudo decodificar la imagen HEIC: {error}"))?;
        let rgba = RgbaImage::from_raw(decoded.width, decoded.height, decoded.to_rgba8()).ok_or_else(|| "La imagen contiene datos incompletos.".to_string())?;
        DynamicImage::ImageRgba8(rgba)
    } else {
        let image = image_rs::load_from_memory(&source).map_err(|error| format!("No se pudo leer la imagen: {error}"))?;
        let pixels = (image.width() as u64) * (image.height() as u64);
        if pixels > MAX_IMAGE_PIXELS { return Err("La imagen supera el límite de 64 megapíxeles.".into()); }
        image
    };
    let format = match target_format {
        "jpg" => ImageFormat::Jpeg,
        "png" => ImageFormat::Png,
        "webp" => ImageFormat::WebP,
        _ => return Err("Formato de salida no admitido.".into()),
    };
    let mut output = Cursor::new(Vec::new());
    image.write_to(&mut output, format).map_err(|error| format!("No se pudo codificar la imagen: {error}"))?;
    Ok(BASE64.encode(output.into_inner()))
}

pub fn heic_dimensions(image_base64: &str) -> Result<(u32, u32), String> {
    if image_base64.len() > (MAX_SOURCE_BYTES * 4 / 3) + 8 { return Err("El archivo HEIC supera el límite de 80 MB.".into()); }
    let source = BASE64.decode(image_base64).map_err(|_| "El archivo HEIC no contiene datos válidos.".to_string())?;
    let metadata = heif_oxide::read_metadata(&source).map_err(|error| format!("No se pudo leer el encabezado HEIC: {error}"))?;
    let pixels = (metadata.width as u64).checked_mul(metadata.height as u64).ok_or_else(|| "La resolución HEIC no es válida.".to_string())?;
    if pixels > MAX_IMAGE_PIXELS { return Err("La imagen supera el límite de 64 megapíxeles.".into()); }
    Ok((metadata.width, metadata.height))
}

fn write_cache_file(path: &Path, contents: &[u8]) {
    let Some(directory) = path.parent() else {
        return;
    };
    if fs::create_dir_all(directory).is_err() {
        return;
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let temporary_path = path.with_extension(format!("{timestamp}.tmp"));
    if fs::write(&temporary_path, contents).is_ok() {
        if fs::rename(&temporary_path, path).is_err() {
            let _ = fs::remove_file(temporary_path);
        }
    }
}

fn touch_cache_file(path: &Path) {
    if let Ok(file) = fs::OpenOptions::new().write(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

fn prune_cache(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    let mut files: Vec<(PathBuf, u64, SystemTime)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            Some((
                entry.path(),
                metadata.len(),
                metadata.modified().unwrap_or(UNIX_EPOCH),
            ))
        })
        .collect();

    let mut total_size: u64 = files.iter().map(|(_, size, _)| *size).sum();
    if total_size <= CACHE_LIMIT_BYTES {
        return;
    }

    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, size, _) in files {
        if total_size <= CACHE_LIMIT_BYTES {
            break;
        }
        if fs::remove_file(path).is_ok() {
            total_size = total_size.saturating_sub(size);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_exif_rotation_when_decoded_dimensions_are_transposed() {
        let mut image = DynamicImage::ImageRgba8(RgbaImage::new(4, 2));

        match_display_dimensions(&mut image, 2, 4, Some(Orientation::Rotate90)).unwrap();

        assert_eq!((image.width(), image.height()), (2, 4));
    }
}
