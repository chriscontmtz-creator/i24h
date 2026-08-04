import { Router }  from 'express';
import ExcelJS      from 'exceljs';
import path         from 'path';
import { fileURLToPath } from 'url';
import Producto     from '../models/Producto.js';
import { requireEmpleado, sesionActual } from '../middlewares/auth.js';
import { sucursalPermitida } from '../utils/sucursales.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLANTILLAS = path.join(__dirname, '../../datos/plantillas');

const router = Router();

// ── Mapeo nombre display → clave MongoDB (igual que bitacoras.js) ──────────
const SUCURSAL_DB = {
  'Simón Bolívar': 'SimonBolivar',
  'Insurgentes':   'Insurgentes',
  'Antígona':      'Antigona',
  'Lincoln Oxxo':  'LincolnOxxo',
  'Lincoln 2':     'LincolnDos',
  'Ruiz Cortines': 'RuizCortines',
  'Rodas':         'Rodas',
  'Cuauhtémoc':    'Cuauhtemoc',
  'Ordóñez':       'Ordonez',
};

// ── Nombre display → nombre para el archivo Excel (sin tildes, mayúsculas) ──
const SUCURSAL_EXCEL = {
  'Simón Bolívar': 'SIMON BOLIVAR',
  'Insurgentes':   'INSURGENTES',
  'Antígona':      'ANTIGONA',
  'Lincoln Oxxo':  'LINCOLN OXXO',
  'Lincoln 2':     'LINCOLN 2',
  'Ruiz Cortines': 'RUIZ CORTINES',
  'Rodas':         'RODAS',
  'Cuauhtémoc':    'CUAUHTEMOC',
  'Ordóñez':       'ORDONEZ',
};

// ── Nombre de categoría para el archivo ─────────────────────────────────────
const CAT_EXCEL = {
  limpieza:  'LIMPIEZA',
  novedades: 'NOVEDADES',
  papeleria: 'PAPELERÍA',
  snack:     'SNACK',
};

// ── Mapeos: nombre en Excel → nombre exacto en MongoDB (trim al comparar) ───
// null = no existe en DB → queda en 0
const MAPEO = {
  limpieza: [
    { excel: 'CLORO',                       db: 'CLORO' },
    { excel: 'WINDEX',                      db: 'WINDEX' },
    { excel: 'GLADE /WISE',                 db: 'GLADEWISE' },
    { excel: 'JABON DE MANOS',              db: 'JABON DE MANOS' },
    { excel: 'FABULOSO',                    db: 'FABULOSO' },
    { excel: 'BOLSA GRANDE',                db: 'BOLSA GRANDE' },
    { excel: 'BOLSA CHICA',                 db: 'BOLSA CHICA' },
    { excel: 'PAPEL SECANTE',               db: 'PAPEL SECANTE' },
    { excel: 'PAPEL HIGIENICO',             db: 'PAPEL HIGIENICO' },
    { excel: 'GEL ANTIBACTERIAL',           db: 'GEL ANTIBACTERIAL' },
    { excel: 'ESCOBA',                      db: 'ESCOBA' },
    { excel: 'TRAPEADOR VILEDA',            db: 'TRAPEADOR VILEDA' },
    { excel: 'MOP/ MECHUDO DE TRAPEADOR',   db: 'MOPMECHUDO DE TRAPEADOR' },
    { excel: 'TINA VILEDA',                 db: 'TINA VILEDA' },
    { excel: 'RECOGEDOR',                   db: 'RECOGEDOR' },
    { excel: 'CEPILLO PARA EL BAÑO',        db: 'CEPILLO PARA EL BAÑO' },
    { excel: 'INSECTICIDA',                 db: 'INSECTICIDA' },
    { excel: 'DESTAPACAÑOS',                db: 'DESTAPACAÑOS' },
    { excel: 'FEBREZZE',                    db: 'FEBREZZE' },
    { excel: 'TRAPOS',                      db: 'TRAPOS' },
    { excel: 'PLUMERO',                     db: 'PLUMERO' },
    { excel: 'ATOMIZADOR',                  db: 'ATOMIZADOR' },
    { excel: 'HARPIC',                      db: 'HARPIC' },
    { excel: 'ARTURITO',                    db: 'ARTURITO' },
    { excel: 'TRAPEADOR',                   db: 'TRAPEADOR' },
    { excel: 'GUANTES',                     db: 'GUANTES' },
    { excel: 'BOTE DE BASURA',              db: 'BOTE DE BASURA' },
  ],

  novedades: [
    { excel: 'NOVEDAD ROJO 20',    db: 'NOVEDADES ROJO 20' },
    { excel: 'NOVEDAD AZUL 30',    db: 'NOVEDADES AZUL 30' },
    { excel: 'NOVEDAD VERDE 40',   db: 'NOVEDADES VERDE 40' },
    { excel: 'NOVEDAD MORADO 50',  db: 'NOVEDADES MORADO 50' },
    { excel: 'NOVEDAD AMARILLO 60',db: 'NOVEDADES AMARILLO 60' },
    { excel: 'NOVEDAD ROSA 80',    db: 'NOVEDADES ROSA 80' },
    { excel: 'NOVEDAD PLATEADA 100',db:'NOVEDADES PLATEADA 100' },
    { excel: 'NOVEDAD BLANCO 160', db: 'NOVEDADES BLANCO 160' },
    { excel: 'NOVEDAD DORADA 150', db: 'NOVEDADES DORADA 150' },
    { excel: 'NOVEDAD NEGRA 350',  db: 'NOVEDADES NEGRA' },
    { excel: 'LLAVERO 40',         db: 'LLAVERO FUNKO' },
  ],

  papeleria: [
    // Tabloides (INVENTARIO)
    { excel: 'TABLOIDE ADHESIVO',          db: 'TABLOIDE ADHESIVO' },
    { excel: 'TABLOIDE OPALINA',           db: 'TABLOIDE OPALINA' },
    { excel: 'TABLOIDE COUCHE',            db: 'TABLOIDE COUCHE' },
    { excel: 'TABLOIDE COUCHE MATE',       db: null },
    // Hojas (INVENTARIO / Z USO INTERNO)
    { excel: 'HOJA DOBLE CARTA',           db: 'Doble Carta' },
    { excel: 'FOLDER OFI. CREMA',          db: 'LEGAJO OFICIO' },
    // Enmicados
    { excel: 'MICA OFICIO',                db: 'ENMICADO3 OFICIO' },
    // Z USO INTERNO
    { excel: 'HOJA OFICIO',                db: 'HOJA OFICIO' },
    { excel: 'HOJA CARTA',                 db: 'HOJA CARTA' },
    // Folders → Legajos (cat 117)
    { excel: 'FOLDER CARTA',               db: 'LEGAJO CARTA' },
    { excel: 'FOLDER COLOR',               db: 'LEGAJO CARTA COLOR' },
    { excel: 'FOLDER COSTILLA',            db: 'LEGAJO COSTILLA' },
    // Papelería
    { excel: 'SOBRE CARTA',                db: 'SOBRE CARTA' },
    { excel: 'PASTAS  MULTICOLOR',         db: 'PASTA MULTICOLOR' },
    { excel: 'PASTAS TRANSPARENTE',        db: 'PASTA TRANSPARENTE' },
    { excel: 'PASTAS NEGRO',               db: 'PASTA NEGRA' },
    // Enmicados
    { excel: 'MICA CARTA',                 db: 'ENMICADO2 CARTA' },
    // Hojas carta (INVENTARIO — nombre exacto en CyberPlanet)
    { excel: 'CARTA OPALINA',              db: 'Carta Opalina' },
    { excel: 'SOLICITUD DE EMPLEO',        db: 'SOLICITUD DE EMPLEO' },
    { excel: 'CARTA ADHESIVA',             db: 'Carta Adhesiva' },
    { excel: 'CARTA COUCHE',               db: 'Carta Couche' },
    // Enmicados
    { excel: 'MICA CREDENCIAL',            db: 'ENMICADO1 CREDENCIAL' },
    // Consumibles (cat 107)
    { excel: 'CD-R SONY',                  db: 'CD' },
    { excel: 'DVD SONY',                   db: 'DVD' },
    // Arilos (cat 107)
    { excel: 'ARILLO #1 "3/8"',            db: 'Arillo 1' },
    { excel: 'ARILLO #2 "1/2"',            db: 'Arillo 2' },
    { excel: 'ARILLO #3 "5/8"',            db: 'Arillo 3' },
    { excel: 'ARILLO #4 "7/8"',            db: 'Arillo 4' },
    { excel: 'ARILLO #5 "1 PULGADA"',      db: 'Arillo 5' },
    // Material (cat 117)
    { excel: 'CARTULINA',                  db: 'CARTULINA' },
    // Z USO INTERNO (cat 115)
    { excel: 'SOBRE NOMINA',               db: 'SOBRE NOMINA' },
    { excel: 'CLIPS',                      db: 'CLIPS' },
    { excel: 'GRAPAS',                     db: 'GRAPAS' },
    { excel: 'ROLLO TERMICO GRANDE',       db: 'ROLLO TERMICO GRANDE' },
    // Plumas (cat 107)
    { excel: 'PLUMA NEGRA',                db: 'PLUMA NEGRA' },
    { excel: 'PLUMA AZUL',                 db: 'PLUMA AZUL' },
    { excel: 'PLUMA ROJA',                 db: 'PLUMA ROJA' },
    // Material (cat 117)
    { excel: 'USB',                        db: 'MEMORIA USB 32GB' },
    // Herramientas (cat 115)
    { excel: 'GUILLOTINA',                 db: 'GUILLOTINA' },
    { excel: 'ENMICADORA',                 db: 'ENMICADORA' },
    { excel: 'ROLLO PLOTTER',              db: 'ROLLO PLOTTER' },
    { excel: 'TINTA CYAN',                 db: 'TINTA CYAN' },
    { excel: 'TINTA YELLOW',               db: 'TINTA YELLOW' },
    { excel: 'TINTA MAGENTA',              db: 'TINTA MAGENTA' },
    { excel: 'TINTA NEGRO',                db: 'TINTA NEGRO' },
    { excel: 'ENGARGOLADORA',              db: 'ENGARGOLADORA' },
    { excel: 'TIJERAS',                    db: 'TIJERAS' },
    { excel: 'CALCULADORA',                db: 'CALCULADORA' },
    { excel: 'PERFORADORA',                db: 'PERFORADORA' },
    { excel: 'GRAPADORA',                  db: 'GRAPADORA' },
    { excel: 'PLUMON DE BILLETES FALSOS',  db: 'PLUMON DE BILLETES FALSO' },
    { excel: 'QUITA GRAPAS',               db: 'QUITA GRAPAS' },
    { excel: 'CINTA DOBLE CARA (HAWAIANA)',db: 'CINTA DOBLE CARA (HAWAIANA)' },
    { excel: 'CINTA DOBLE CARA (MONTAJE)', db: 'CINTA DOBLE CARA (MONTAJE)' },
    { excel: 'CORRECTOR',                  db: 'CORRECTOR' },
    { excel: 'REGLA',                      db: 'REGLA' },
    { excel: 'DESPACHADOR DE CINTA FILAMENTO', db: 'DESPACHADOR DE CINTA FILAMENTO' },
    { excel: 'CINTA FILAMENTO',            db: 'CINTA FILAMENTO' },
    { excel: 'QUITA GOMA',                 db: 'QUITA GOMA' },
  ],

  snack: [
    { excel: 'AGUA 500ML',       db: 'AGUA 500 ML' },
    { excel: 'CHOCOLATES VARIOS',db: 'CHOCOLATES VARIOS' },
    { excel: 'CLORETS',          db: null },
    { excel: 'COCA COLA LATA',   db: 'COCA COLA' },
    { excel: 'PULPARINDOS',      db: null },
    { excel: 'DUVALIN',          db: 'DUVALIN' },
    { excel: 'FRUTSI',           db: 'FRUTSI O PAU PAU VARIOS' },
    { excel: 'GALLETAS VARIOS',  db: 'GALLETA VARIOS' },
    { excel: 'GOMITAS VARIOS',   db: 'GOMITAS VARIOS' },
    { excel: 'MAZAPAN AZTECA',   db: 'MAZAPAN AZTECA' },
    { excel: 'PALETA PAYASO',    db: 'PALETA PAYASO' },
    { excel: 'SABRITAS VARIOS',  db: 'SABRITAS VARIOS' },
    { excel: 'SKWINKLES',        db: 'SKWINKLES VARIOS' },
    { excel: 'PALETA VARIOS',    db: null },
  ],
};

// ── Normalizar: trim + uppercase ─────────────────────────────────────────────
const norm = s => String(s ?? '').trim().toUpperCase();

// ── GET /api/inventario/descargar ────────────────────────────────────────────
router.get('/inventario/descargar', sesionActual, requireEmpleado, async (req, res) => {
  try {
    const { sucursal, categoria, fecha } = req.query;

    if (!sucursal || !categoria || !fecha) {
      return res.status(400).json({ error: 'Faltan parámetros: sucursal, categoria, fecha' });
    }
    if (sucursal === 'Todas las sucursales') {
      if (req.session.usuario.cargo !== 'admin')
        return res.status(403).json({ error: 'No tienes acceso a todas las sucursales.' });
    } else if (!(await sucursalPermitida(req.session.usuario, sucursal))) {
      return res.status(403).json({ error: 'No tienes acceso a esa sucursal.' });
    }

    const catKey = categoria.toLowerCase();
    if (!MAPEO[catKey]) {
      return res.status(400).json({ error: 'Categoría inválida. Usa: limpieza, novedades, papeleria, snack' });
    }

    // Clave DB y nombres para archivo
    const dbKey       = SUCURSAL_DB[sucursal] || sucursal;
    const sucExcel    = SUCURSAL_EXCEL[sucursal] || norm(sucursal);
    const catExcel    = CAT_EXCEL[catKey];

    // Fecha para celda C3 y nombre de archivo
    const fechaObj  = new Date(fecha + 'T12:00:00');
    const dd = String(fechaObj.getDate()).padStart(2, '0');
    const mm = String(fechaObj.getMonth() + 1).padStart(2, '0');
    const yy = String(fechaObj.getFullYear()).slice(2);
    const fechaStr  = `${dd}-${mm}-${yy}`;
    const nombreArchivo = `INVENTARIO DE ${catExcel} ${sucExcel} ${fechaStr}.xlsx`;

    // Consultar stock de la sucursal en MongoDB
    const productos = await Producto.find(
      { sucursal: dbKey, nombre: { $not: /^Nuevo Producto/i } }
    ).select('nombre stock').lean();

    // Lookup normalizado: NOMBRE_DB_NORM → stock
    const stockMap = {};
    for (const p of productos) {
      stockMap[norm(p.nombre)] = p.stock ?? 0;
    }

    // Construir lookup: NOMBRE_EXCEL_NORM → stock final
    const excelLookup = {};
    for (const { excel, db } of MAPEO[catKey]) {
      excelLookup[norm(excel)] = db !== null ? (stockMap[norm(db)] ?? 0) : 0;
    }

    // Cargar plantilla y rellenar
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(PLANTILLAS, `${catKey === 'papeleria' ? 'PAPELERIA' : catExcel}.xlsx`));
    const ws = wb.getWorksheet('Hoja1');

    // B2 = nombre de sucursal, C3 = fecha como Date
    ws.getCell('B2').value = sucExcel;
    ws.getCell('C3').value = fechaObj;

    // Rellenar stock fila por fila (a partir de fila 4)
    ws.eachRow((row, rowNum) => {
      if (rowNum < 4) return;
      const cellB = row.getCell(2);
      const cellC = row.getCell(3);
      if (!cellB.value) return;

      const nombreNorm = norm(cellB.value);
      if (excelLookup[nombreNorm] !== undefined) {
        cellC.value = excelLookup[nombreNorm];
      }
    });

    // Enviar como descarga
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`);
    res.send(buffer);

  } catch (err) {
    console.error('[inventario] descargar:', err.message);
    res.status(500).json({ error: 'Error al generar el archivo' });
  }
});

export default router;
