import fs   from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __filename     = fileURLToPath(import.meta.url);
const __dirname      = path.dirname(__filename);
const CARPETA_DATOS  = path.join(__dirname, '../../datos');

// Lee un archivo JSON de la carpeta /datos y devuelve su contenido.
// Si el archivo todavía no existe (p. ej. codigos.json/usuarios.json están en
// .gitignore y un deploy nuevo nunca los ha escrito), devuelve [] en vez de
// tronar — antes esto rompía /api/resumen con un 500 en cualquier deploy
// fresco donde nadie hubiera generado un código todavía.
export function leer(archivo) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CARPETA_DATOS, archivo), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Guarda datos en un archivo JSON dentro de /datos
export function guardar(archivo, datos) {
  fs.writeFileSync(path.join(CARPETA_DATOS, archivo), JSON.stringify(datos, null, 2));
}
