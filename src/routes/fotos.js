import { Router }  from 'express';
import multer      from 'multer';
import sharp       from 'sharp';
import fs           from 'fs';
import path         from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import FotoSucursal, { SUCURSALES } from '../models/FotoSucursal.js';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARPETA_FOTOS = path.join(__dirname, '../../public/imagenes/sucursales');
fs.mkdirSync(CARPETA_FOTOS, { recursive: true });

const router = Router();

// Archivo a memoria (nunca a disco sin validar) — límite de 5MB, un solo
// archivo por petición. El fileFilter es solo un primer filtro barato;
// la validación real pasa por sharp más abajo, porque el mimetype que
// manda el navegador no es confiable.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

// GET /api/fotos-sucursal — lista todas (panel admin), o filtradas por ?sucursal=
router.get('/fotos-sucursal', requireAuth, async (req, res) => {
  try {
    const filtro = req.query.sucursal ? { sucursal: req.query.sucursal } : {};
    const fotos  = await FotoSucursal.find(filtro).sort({ createdAt: -1 });
    res.json(fotos);
  } catch {
    res.status(500).json({ error: 'Error al obtener las fotos' });
  }
});

// Envuelve upload.single() para responder en JSON si el archivo excede el
// límite u otro error de multer, en vez de dejar que caiga al handler de
// error genérico de Express (que devolvería HTML, no JSON).
function subirFoto(req, res, next) {
  upload.single('foto')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen no puede pesar más de 5MB' : 'Error al subir el archivo';
      return res.status(400).json({ error: msg });
    }
    if (err) return res.status(400).json({ error: 'Error al subir el archivo' });
    next();
  });
}

// POST /api/fotos-sucursal — sube una foto nueva (campo "foto")
router.post('/fotos-sucursal', requireAuth, requireAdmin, subirFoto, async (req, res) => {
  const { sucursal } = req.body;
  if (!SUCURSALES.includes(sucursal))
    return res.status(400).json({ error: 'Sucursal inválida' });
  if (!req.file)
    return res.status(400).json({ error: 'Selecciona una imagen (jpg, png o webp), máx. 5MB' });

  let bufferFinal;
  try {
    // Decodifica y vuelve a construir la imagen desde cero: si el archivo
    // no es una imagen real, sharp truena aquí y se rechaza. De paso
    // normaliza el formato, limita el tamaño y borra metadatos (EXIF/GPS).
    bufferFinal = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return res.status(400).json({ error: 'El archivo no es una imagen válida' });
  }

  const nombreArchivo = randomUUID() + '.jpg';
  try {
    fs.writeFileSync(path.join(CARPETA_FOTOS, nombreArchivo), bufferFinal);
    const nueva = await FotoSucursal.create({
      sucursal,
      archivo:   nombreArchivo,
      subidaPor: req.session.usuario?.nombre || req.session.usuario?.correo || 'admin',
    });
    res.json(nueva);
  } catch {
    res.status(500).json({ error: 'Error al guardar la foto' });
  }
});

// DELETE /api/fotos-sucursal/:id — elimina el registro y el archivo físico
router.delete('/fotos-sucursal/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const foto = await FotoSucursal.findById(req.params.id);
    if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });

    try {
      fs.unlinkSync(path.join(CARPETA_FOTOS, foto.archivo));
    } catch {
      // Si el archivo ya no está en disco no debe impedir borrar el registro
    }

    await foto.deleteOne();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error al eliminar la foto' });
  }
});

export default router;
