# Luma

Luma es un visor de fotografías de escritorio, ligero y multiplataforma para Windows y Linux. Está pensado para abrir y recorrer imágenes con rapidez, con atención especial a HEIC/HEIF de teléfonos Samsung. Su interfaz pone la fotografía en primer plano y mantiene los controles habituales a mano.

## Qué puedes hacer

- Añadir fotografías desde el selector de archivos o arrastrándolas a la ventana.
- Ver imágenes JPG/JPEG, PNG y WebP directamente, y HEIC/HEIF mediante el decodificador del backend en Rust.
- Abrir una foto en el visor, ajustar el zoom, desplazar la imagen ampliada y recorrer la colección.
- Consultar propiedades como el formato, el tamaño, la fecha de modificación y las dimensiones.
- Ver las coordenadas GPS guardadas en los metadatos EXIF. Si la foto tiene ubicación, puedes cargar un mapa de OpenStreetMap; solo entonces se envían solicitudes de mosaicos de esa zona al servicio.
- Convertir una imagen a JPG, PNG o WebP y guardar una copia en Descargas. La conversión no modifica el original.

## Estado actual

Luma está en desarrollo. Las fotografías añadidas se mantienen en la sesión actual de la app; todavía no se guardan en una biblioteca persistente ni se indexan carpetas automáticamente. Al cerrar o recargar la app, tendrás que volver a añadirlas.

La lectura y generación de vistas previas HEIC/HEIF se realiza localmente. El límite actual para el procesamiento HEIC es de 80 MB por archivo y 64 megapíxeles. La compatibilidad con variantes HEVC, perfiles de color y metadatos puede depender del archivo y todavía requiere pruebas con una colección amplia de fotografías.

## Tecnologías

- **Interfaz:** React, TypeScript y Vite.
- **Escritorio:** Tauri 2.
- **Procesamiento de imágenes:** Rust, `image`, `heif-oxide` y `kamadak-exif`.

## Desarrollo

Necesitas Node.js, npm, Rust y las dependencias de escritorio requeridas por Tauri para tu sistema operativo.

```sh
npm install
npx tauri dev
```

Para compilar la interfaz:

```sh
npm run build
```

Consulta la [guía oficial de prerrequisitos de Tauri](https://tauri.app/start/prerequisites/) para instalar los componentes necesarios en Windows o Linux.
