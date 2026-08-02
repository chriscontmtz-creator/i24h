import mongoose from 'mongoose';

const SUCURSALES = [
  'Simón Bolívar', 'Insurgentes', 'Antígona', 'Lincoln Oxxo', 'Lincoln 2',
  'Ruiz Cortines', 'Rodas', 'Cuauhtémoc', 'Ordóñez',
];

const FotoSucursalSchema = new mongoose.Schema({
  sucursal:  { type: String, required: true, enum: SUCURSALES },
  archivo:   { type: String, required: true, trim: true },
  subidaPor: { type: String, default: null },
}, { timestamps: true });

export default mongoose.model('FotoSucursal', FotoSucursalSchema);
export { SUCURSALES };
