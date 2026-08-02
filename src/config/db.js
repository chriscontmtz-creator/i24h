import mongoose from 'mongoose';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env'), override: true });

export default function conectarDB() {
  mongoose.connect(process.env.MONGO_URI, { dbName: 'i24h' })
    .then(() => console.log('✓ Conectado a MongoDB Atlas · base: i24h'))
    .catch(err => {
      console.error('✗ Error MongoDB:', err.message);
      console.error('  → El servidor sigue activo pero las funciones de cuenta no funcionarán hasta reconectar.');
    });
}
