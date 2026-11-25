import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type Photo = {
  id: string;
  name: string;
  url: string;
  status: "loading" | "ready" | "error";
  sourceFile?: File;
  width?: number;
  height?: number;
  location?: { latitude: number; longitude: number } | null;
  locationChecked?: boolean;
  locationLoading?: boolean;
  locationReadError?: boolean;
  mapVisible?: boolean;
  mapZoom?: number;
  viewerUrl?: string;
  viewerLoading?: boolean;
  viewerError?: string;
  error?: string;
};

const supportedExtensions = /\.(jpe?g|png|webp|heic|heif)$/i;
const heicExtensions = /\.(heic|heif)$/i;
const maxHeicFileSize = 80 * 1024 * 1024;

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("No se pudo leer el archivo."));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function thumbnailUrlFromBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
}

function getFileExtension(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex > 0 && dotIndex < filename.length - 1
    ? filename.slice(dotIndex + 1).toUpperCase()
    : "SIN FORMATO";
}

function getFormatClass(filename: string) {
  switch (getFileExtension(filename)) {
    case "JPG": return "photo-format-jpg";
    case "JPEG": return "photo-format-jpeg";
    case "PNG": return "photo-format-png";
    case "WEBP": return "photo-format-webp";
    case "HEIC": return "photo-format-heic";
    case "HEIF": return "photo-format-heif";
    default: return "photo-format-other";
  }
}

function getMapTiles(latitude: number, longitude: number, zoom: number) {
  const tileCount = 2 ** zoom;
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = clampedLatitude * Math.PI / 180;
  const pointX = ((longitude + 180) / 360) * tileCount;
  const pointY = ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * tileCount;
  const centerX = Math.floor(pointX);
  const centerY = Math.floor(pointY);
  const startX = centerX - 2;
  const startY = centerY - 1;
  const tiles = [];

  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const x = ((startX + column) % tileCount + tileCount) % tileCount;
      const y = startY + row;
      if (y < 0 || y >= tileCount) continue;
      tiles.push({ x: column, y: row, url: `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png` });
    }
  }

  return {
    tiles,
    markerLeft: ((pointX - startX) / 4) * 100,
    markerTop: ((pointY - startY) / 2) * 100,
  };
}

function clampViewerPan(x: number, y: number, scale: number, viewport: HTMLDivElement | null, image: HTMLImageElement | null) {
  if (!viewport || !image || !image.offsetWidth || !image.offsetHeight) return { x, y };

  const maxX = Math.max(0, (image.offsetWidth * scale - viewport.clientWidth) / 2);
  const maxY = Math.max(0, (image.offsetHeight * scale - viewport.clientHeight) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  };
}

function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(100);
  const [viewerBaseSize, setViewerBaseSize] = useState<{ photoId: string; width: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [conversionFormat, setConversionFormat] = useState("jpg");
  const [conversionStatus, setConversionStatus] = useState("");
  const [showDetails, setShowDetails] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  const viewerRequestsRef = useRef(new Set<string>());
  const viewerWrapRef = useRef<HTMLDivElement>(null);
  const viewerImageRef = useRef<HTMLImageElement>(null);
  const viewerPanDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => () => urlsRef.current.forEach(URL.revokeObjectURL), []);

  useEffect(() => {
    if (activePhotoIndex === null) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActivePhotoIndex(null);
      if (event.key === "ArrowRight") {
        setActivePhotoIndex((current) => current === null ? null : (current + 1) % photos.length);
      }
      if (event.key === "ArrowLeft") {
        setActivePhotoIndex((current) => current === null ? null : (current - 1 + photos.length) % photos.length);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePhotoIndex, photos.length]);

  useEffect(() => {
    setZoom(100);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
    setConversionStatus("");
    setShowDetails(true);
  }, [activePhotoIndex]);

  useEffect(() => {
    if (zoom <= 100) {
      setPan({ x: 0, y: 0 });
      return;
    }

    const viewport = viewerWrapRef.current;
    const image = viewerImageRef.current;
    if (!viewport || !image) return;

    const clampPan = () => {
      setPan((current) => clampViewerPan(current.x, current.y, zoom / 100, viewport, image));
    };
    const observer = new ResizeObserver(clampPan);
    observer.observe(viewport);
    observer.observe(image);
    clampPan();

    return () => observer.disconnect();
  }, [zoom, activePhotoIndex]);

  async function addPhotos(files: FileList | File[]) {
    const selected = Array.from(files).filter((file) =>
      supportedExtensions.test(file.name),
    );

    for (const file of selected) {
      const isHeic = heicExtensions.test(file.name);
      const id = `${file.name}-${file.lastModified}-${crypto.randomUUID()}`;
      const photo: Photo = {
        id,
        name: file.name,
        url: isHeic ? "" : URL.createObjectURL(file),
        status: isHeic ? "loading" : "ready",
        sourceFile: file,
      };

      if (photo.url) urlsRef.current.push(photo.url);
      setPhotos((current) => [...current, photo]);

      if (!isHeic) continue;
      if (file.size > maxHeicFileSize) {
        setPhotos((current) => current.map((item) => item.id === id
          ? { ...item, status: "error", error: "El archivo supera el límite de 80 MB." }
          : item));
        continue;
      }

      try {
        const imageBase64 = await fileToBase64(file);
        const [width, height] = await invoke<[number, number]>("heic_dimensions", { imageBase64 });
        const thumbnailBase64 = await invoke<string>("decode_heic_thumbnail", {
          imageBase64,
          maxSide: 512,
        });
        const url = thumbnailUrlFromBase64(thumbnailBase64);
        urlsRef.current.push(url);
        setPhotos((current) => current.map((item) => item.id === id
          ? { ...item, url, status: "ready", width, height }
          : item));
      } catch (error) {
        setPhotos((current) => current.map((item) => item.id === id
          ? { ...item, status: "error", error: String(error) }
          : item));
      }
    }
  }

  function moveViewer(direction: -1 | 1) {
    setActivePhotoIndex((current) => current === null ? null : (current + direction + photos.length) % photos.length);
  }

  function openPhoto(index: number) {
    const photo = photos[index];
    setActivePhotoIndex(index);
    if (photo.sourceFile && !photo.locationChecked && !photo.locationLoading) {
      setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, locationLoading: true } : item));
      void (async () => {
        try {
          const imageBase64 = await fileToBase64(photo.sourceFile!);
          const location = await invoke<Photo["location"]>("image_location", { imageBase64 });
          setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, location, locationChecked: true, locationLoading: false } : item));
        } catch {
          setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, location: null, locationChecked: true, locationLoading: false, locationReadError: true } : item));
        }
      })();
    }
    if (!photo.sourceFile || !heicExtensions.test(photo.name) || photo.viewerUrl || viewerRequestsRef.current.has(photo.id)) return;

    viewerRequestsRef.current.add(photo.id);
    setPhotos((current) => current.map((item) => item.id === photo.id
      ? { ...item, viewerLoading: true, viewerError: undefined }
      : item));

    void (async () => {
      try {
        const imageBase64 = await fileToBase64(photo.sourceFile!);
        const fullThumbnailBase64 = await invoke<string>("decode_heic_thumbnail", {
          imageBase64,
          maxSide: 4096,
        });
        const viewerUrl = thumbnailUrlFromBase64(fullThumbnailBase64);
        urlsRef.current.push(viewerUrl);
        setPhotos((current) => current.map((item) => item.id === photo.id
          ? { ...item, viewerUrl, viewerLoading: false }
          : item));
      } catch (error) {
        setPhotos((current) => current.map((item) => item.id === photo.id
          ? { ...item, viewerLoading: false, viewerError: String(error) }
          : item));
      } finally {
        viewerRequestsRef.current.delete(photo.id);
      }
    })();
  }

  async function convertPhoto(photo: Photo) {
    if (!photo.sourceFile) return;
    setConversionStatus("Convirtiendo…");
    try {
      const imageBase64 = await fileToBase64(photo.sourceFile);
      const convertedBase64 = await invoke<string>("convert_image", {
        imageBase64,
        sourceExtension: getFileExtension(photo.name).toLowerCase(),
        targetFormat: conversionFormat,
      });
      const binary = atob(convertedBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const mime = conversionFormat === "jpg" ? "image/jpeg" : `image/${conversionFormat}`;
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${photo.name.replace(/\.[^.]+$/, "")}.${conversionFormat}`;
      link.click();
      URL.revokeObjectURL(url);
      setConversionStatus("Copia convertida guardada en Descargas.");
    } catch (error) {
      setConversionStatus(`No se pudo convertir: ${String(error)}`);
    }
  }

  function handleViewerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (zoom <= 100 || event.button !== 0) return;
    event.preventDefault();
    viewerPanDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function handleViewerPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = viewerPanDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampViewerPan(
      drag.originX + event.clientX - drag.startX,
      drag.originY + event.clientY - drag.startY,
      zoom / 100,
      viewerWrapRef.current,
      viewerImageRef.current,
    );
    setPan(next);
  }

  function endViewerPan(event: React.PointerEvent<HTMLDivElement>) {
    if (viewerPanDragRef.current?.pointerId !== event.pointerId) return;
    viewerPanDragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <main
      className={`app-shell${isDragging ? " is-dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setIsDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        void addPhotos(event.dataTransfer.files);
      }}
    >
      <aside className="sidebar">
        <a className="brand" href="#inicio" aria-label="Luma, inicio">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>luma</span>
        </a>

        <div className="sidebar-label">BIBLIOTECA</div>
        <button className="nav-item nav-item-active" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>
          <span>Fotos</span>
          {photos.length > 0 && <span className="photo-count">{photos.length}</span>}
        </button>

        <div className="sidebar-bottom">
          <div className="sidebar-note-mark" aria-hidden="true">✳</div>
          <p>Tus recuerdos,<br />en un solo lugar.</p>
        </div>
      </aside>

      <section className="main-panel" id="inicio">
        <header className="topbar">
          <div className="breadcrumb"><span>Biblioteca</span><span className="breadcrumb-separator">/</span><strong>Fotos</strong></div>
          <button className="add-button" type="button" onClick={() => inputRef.current?.click()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            <span>Añadir fotos</span>
          </button>
          <input
            ref={inputRef}
            className="file-input"
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            onChange={(event) => {
              if (event.currentTarget.files) void addPhotos(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </header>

        <div className="content-area">
          <div className="page-heading">
            <div>
              <p className="eyebrow">TU COLECCIÓN</p>
              <h1>Fotos</h1>
              <p className="page-subtitle">
                {photos.length === 0
                  ? "Un espacio tranquilo para todo lo que quieres recordar."
                  : `${photos.length} ${photos.length === 1 ? "foto" : "fotos"} en tu biblioteca`}
              </p>
            </div>
            {photos.length > 0 && <span className="collection-date">RECIENTES</span>}
          </div>

          {photos.length === 0 ? (
            <div className="empty-state">
              <div className="empty-art" aria-hidden="true">
                <div className="art-sun" />
                <div className="art-photo art-photo-back"><span /></div>
                <div className="art-photo art-photo-front">
                  <span className="art-mountain art-mountain-one" />
                  <span className="art-mountain art-mountain-two" />
                  <span className="art-water" />
                </div>
                <span className="art-sparkle sparkle-one">✳</span>
                <span className="art-sparkle sparkle-two">✳</span>
              </div>
              <h2>Tu galería empieza aquí</h2>
              <p>Añade algunas fotos para llenar este espacio<br className="desktop-break" /> con tus momentos favoritos.</p>
              <button className="empty-button" type="button" onClick={() => inputRef.current?.click()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                Añadir fotos
              </button>
              <span className="format-hint">JPG, PNG, WEBP, HEIC o HEIF · También puedes arrastrarlas aquí</span>
            </div>
          ) : (
            <div className="photo-grid" aria-label="Fotos de tu biblioteca">
              {photos.map((photo) => (
                <figure className="photo-card" key={photo.id}>
                  <button className="photo-open" type="button" onClick={() => openPhoto(photos.indexOf(photo))} disabled={photo.status !== "ready"} aria-label={`Abrir ${photo.name}, formato ${getFileExtension(photo.name)}`} title={photo.error}>
                    <span className={`photo-preview${photo.status === "loading" ? " photo-preview-loading" : ""}${photo.status === "error" ? " photo-preview-error" : ""}`}>
                      {photo.status === "ready" && <img src={photo.url} alt="" />}
                      {photo.status === "loading" && <span className="preview-message">Preparando vista previa…</span>}
                      {photo.status === "error" && <span className="preview-message">No se pudo leer la imagen</span>}
                    </span>
                    <span className={`photo-format ${getFormatClass(photo.name)}`} aria-hidden="true">{getFileExtension(photo.name)}</span>
                    <span className="photo-caption" title={photo.name}>{photo.name}</span>
                  </button>
                </figure>
              ))}
            </div>
          )}
        </div>
      </section>

      {isDragging && <div className="drop-overlay"><div><span className="drop-icon">↓</span><strong>Suelta tus fotos aquí</strong><span>JPG, PNG, WEBP, HEIC o HEIF</span></div></div>}

      {activePhotoIndex !== null && photos[activePhotoIndex] && (
        <div className="viewer-overlay" role="presentation" onClick={() => setActivePhotoIndex(null)}>
          <section className="viewer-shell" role="dialog" aria-modal="true" aria-label={`Visor de fotos: ${photos[activePhotoIndex].name}`} onClick={(event) => event.stopPropagation()}>
            <header className="viewer-toolbar">
              <div className="viewer-file-info">
                <strong title={photos[activePhotoIndex].name}>{photos[activePhotoIndex].name}</strong>
                <span>{activePhotoIndex + 1} de {photos.length}</span>
              </div>
              <div className="viewer-zoom-controls" aria-label="Controles de zoom">
                <button className="viewer-zoom-button" type="button" aria-label="Alejar" onClick={() => setZoom((current) => Math.max(50, current - 10))} disabled={zoom <= 50}>−</button>
                <input className="viewer-zoom-slider" type="range" min="50" max="300" step="10" value={zoom} aria-label="Nivel de zoom" onChange={(event) => setZoom(Number(event.currentTarget.value))} />
                <button className="viewer-zoom-button" type="button" aria-label="Acercar" onClick={() => setZoom((current) => Math.min(300, current + 10))} disabled={zoom >= 300}>+</button>
                <button className="viewer-zoom-value" type="button" aria-label="Restablecer zoom al 100 por ciento" onClick={() => setZoom(100)}>{zoom}%</button>
              </div>
              <button className="viewer-control viewer-close" type="button" aria-label="Cerrar visor" onClick={() => setActivePhotoIndex(null)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </header>
            <div className={`viewer-workspace${showDetails ? "" : " viewer-details-hidden"}`}>
              <div className="viewer-stage">
              <div
                ref={viewerWrapRef}
                className={`viewer-image-wrap${zoom > 100 ? " viewer-can-pan" : ""}${isPanning ? " viewer-is-panning" : ""}`}
                onPointerDown={handleViewerPointerDown}
                onPointerMove={handleViewerPointerMove}
                onPointerUp={endViewerPan}
                onPointerCancel={endViewerPan}
                onLostPointerCapture={() => {
                  viewerPanDragRef.current = null;
                  setIsPanning(false);
                }}
              >
                <img ref={viewerImageRef} draggable="false" className="viewer-image" src={photos[activePhotoIndex].viewerUrl ?? photos[activePhotoIndex].url} alt={photos[activePhotoIndex].name} width={photos[activePhotoIndex].width} height={photos[activePhotoIndex].height} onLoad={(event) => {
                  const activePhoto = photos[activePhotoIndex];
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  const displayedWidth = event.currentTarget.offsetWidth;
                  if (displayedWidth > 0) {
                    setViewerBaseSize((current) => current?.photoId === activePhoto.id
                      ? current
                      : { photoId: activePhoto.id, width: displayedWidth });
                  }
                  setPhotos((current) => current.map((item) => item.id === activePhoto.id
                    ? {
                      ...item,
                      width: item.width ?? naturalWidth,
                      height: item.height ?? naturalHeight,
                    }
                    : item));
                }} style={{
                  width: viewerBaseSize?.photoId === photos[activePhotoIndex].id
                    ? `${viewerBaseSize.width}px`
                    : "auto",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom / 100})`,
                }} />
                {photos[activePhotoIndex].viewerLoading && <span className="viewer-status">Preparando imagen…</span>}
                {photos[activePhotoIndex].viewerError && <span className="viewer-status viewer-status-error" title={photos[activePhotoIndex].viewerError}>Se muestra la vista previa</span>}
              </div>
              </div>
              <aside className={`viewer-details${showDetails ? "" : " viewer-details-hidden"}`} aria-label="Propiedades de la foto" aria-hidden={!showDetails}>
                <div className="viewer-details-heading">
                  <div>
                    <p className="viewer-panel-eyebrow">DETALLES</p>
                    <h2>Propiedades</h2>
                  </div>
                  <button className="viewer-details-toggle" type="button" aria-label="Ocultar detalles" title="Ocultar detalles" onClick={() => { setShowDetails(false); setZoom(100); setPan({ x: 0, y: 0 }); }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="m19.4 13.5 1.1.9-1.6 2.8-1.4-.5a7.8 7.8 0 0 1-1.8 1l-.2 1.5h-3.2l-.2-1.5a7.8 7.8 0 0 1-1.8-1l-1.4.5-1.6-2.8 1.1-.9a7.1 7.1 0 0 1 0-2l-1.1-.9 1.6-2.8 1.4.5a7.8 7.8 0 0 1 1.8-1l.2-1.5h3.2l.2 1.5a7.8 7.8 0 0 1 1.8 1l1.4-.5 1.6 2.8-1.1.9a7.1 7.1 0 0 1 0 2Z"/></svg>
                  </button>
                </div>
                <dl className="photo-properties">
                  <div><dt>Nombre</dt><dd title={photos[activePhotoIndex].name}>{photos[activePhotoIndex].name}</dd></div>
                  <div><dt>Formato</dt><dd><span className={`photo-format-inline ${getFormatClass(photos[activePhotoIndex].name)}`}>{getFileExtension(photos[activePhotoIndex].name)}</span></dd></div>
                  <div><dt>Tamaño</dt><dd>{photos[activePhotoIndex].sourceFile ? (photos[activePhotoIndex].sourceFile!.size / (1024 * 1024)).toFixed(2) + " MB" : "—"}</dd></div>
                  <div><dt>Modificada</dt><dd>{photos[activePhotoIndex].sourceFile ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(photos[activePhotoIndex].sourceFile!.lastModified) : "—"}</dd></div>
                  {photos[activePhotoIndex].width && <div><dt>Dimensiones</dt><dd>{photos[activePhotoIndex].width} × {photos[activePhotoIndex].height} px</dd></div>}
                  {photos[activePhotoIndex].location && <div><dt>GPS</dt><dd>{photos[activePhotoIndex].location!.latitude.toFixed(5)}, {photos[activePhotoIndex].location!.longitude.toFixed(5)}</dd></div>}
                </dl>
                <section className="viewer-location" aria-label="Ubicación de la foto">
                  <p className="viewer-panel-eyebrow">UBICACIÓN</p>
                  {photos[activePhotoIndex].locationLoading && <p className="location-message">Leyendo ubicación de la foto…</p>}
                  {photos[activePhotoIndex].locationReadError && <p className="location-message">No se pudieron leer los metadatos GPS de esta foto.</p>}
                  {photos[activePhotoIndex].locationChecked && !photos[activePhotoIndex].location && <p className="location-message">Esta foto no contiene coordenadas GPS.</p>}
                  {photos[activePhotoIndex].location && (
                    <>
                      <div className={`location-map-frame${photos[activePhotoIndex].mapVisible ? " location-map-loaded" : ""}`}>
                        {photos[activePhotoIndex].mapVisible ? (
                          (() => {
                            const location = photos[activePhotoIndex].location!;
                            const mapView = getMapTiles(location.latitude, location.longitude, photos[activePhotoIndex].mapZoom ?? 16);
                            return <>
                              <div className="location-tile-grid" aria-label="Mapa de la ubicación">
                                {mapView.tiles.map((tile) => <img key={`${tile.x}-${tile.y}`} src={tile.url} alt="" draggable="false" style={{ gridColumn: tile.x + 1, gridRow: tile.y + 1 }} />)}
                              </div>
                              <span className="map-pin" style={{ left: `${mapView.markerLeft}%`, top: `${mapView.markerTop}%` }} aria-hidden="true" />
                              <div className="map-zoom-controls" aria-label="Zoom del mapa">
                                <button type="button" aria-label="Acercar mapa" disabled={(photos[activePhotoIndex].mapZoom ?? 16) >= 19} onClick={() => setPhotos((current) => current.map((item) => item.id === photos[activePhotoIndex].id ? { ...item, mapZoom: Math.min(19, (item.mapZoom ?? 16) + 1) } : item))}>+</button>
                                <button type="button" aria-label="Alejar mapa" disabled={(photos[activePhotoIndex].mapZoom ?? 16) <= 3} onClick={() => setPhotos((current) => current.map((item) => item.id === photos[activePhotoIndex].id ? { ...item, mapZoom: Math.max(3, (item.mapZoom ?? 16) - 1) } : item))}>−</button>
                              </div>
                            </>;
                          })()
                        ) : (
                          <div className="location-map-placeholder" aria-hidden="true"><span className="map-street map-street-one" /><span className="map-street map-street-two" /><span className="map-street map-street-three" /><span className="map-pin">●</span></div>
                        )}
                      </div>
                      {!photos[activePhotoIndex].mapVisible && <button className="viewer-map-button" type="button" onClick={() => setPhotos((current) => current.map((item) => item.id === photos[activePhotoIndex].id ? { ...item, mapVisible: true } : item))}>Cargar mapa</button>}
                      <p className="map-attribution">{photos[activePhotoIndex].mapVisible ? <>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors</> : "El mapa solo se carga cuando lo solicitas."}</p>
                    </>
                  )}
                </section>
                <div className="viewer-convert">
                  <p className="viewer-panel-eyebrow">CONVERTIR</p>
                  <label htmlFor="conversion-format">Formato de salida</label>
                  <select id="conversion-format" value={conversionFormat} onChange={(event) => { setConversionFormat(event.currentTarget.value); setConversionStatus(""); }}>
                    <option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WEBP</option>
                  </select>
                  <button className="viewer-convert-button" type="button" onClick={() => void convertPhoto(photos[activePhotoIndex])}>Convertir y guardar copia</button>
                  {conversionStatus && <p className="conversion-status" role="status">{conversionStatus}</p>}
                  <p className="conversion-note">El original se conserva. La copia se guarda en Descargas.</p>
                </div>
              </aside>
              {!showDetails && <button className="viewer-details-toggle viewer-details-reopen" type="button" aria-label="Mostrar detalles" title="Mostrar detalles" onClick={() => { setShowDetails(true); setZoom(100); setPan({ x: 0, y: 0 }); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="m19.4 13.5 1.1.9-1.6 2.8-1.4-.5a7.8 7.8 0 0 1-1.8 1l-.2 1.5h-3.2l-.2-1.5a7.8 7.8 0 0 1-1.8-1l-1.4.5-1.6-2.8 1.1-.9a7.1 7.1 0 0 1 0-2l-1.1-.9 1.6-2.8 1.4.5a7.8 7.8 0 0 1 1.8-1l.2-1.5h3.2l.2 1.5a7.8 7.8 0 0 1 1.8 1l1.4-.5 1.6 2.8-1.1.9a7.1 7.1 0 0 1 0 2Z"/></svg></button>}
            </div>
            <footer className="viewer-bottom-bar">
              <button className="viewer-control viewer-nav" type="button" aria-label="Foto anterior" onClick={() => moveViewer(-1)} disabled={photos.length < 2}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
              <span>{activePhotoIndex + 1} / {photos.length}</span>
              <button className="viewer-control viewer-nav" type="button" aria-label="Foto siguiente" onClick={() => moveViewer(1)} disabled={photos.length < 2}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;