import fs   from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __filename     = fileURLToPath(import.meta.url);
const __dirname      = path.dirname(__filename);
const CARPETA_DATOS  = path.join(__dirname, '../../datos');

// Lee un archivo JSON de la carpeta /datos y devuelve su contenido
export function leer(archivo) {
  return JSON.parse(fs.readFileSync(path.join(CARPETA_DATOS, archivo), 'utf8'));
}

// Guarda datos en un archivo JSON dentro de /datos
export function guardar(archivo, datos) {
  fs.writeFileSync(path.join(CARPETA_DATOS, archivo), JSON.stringify(datos, null, 2));
}
