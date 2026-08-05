import mongoose from 'mongoose';
import { SUCURSALES } from './FotoSucursal.js';

// Categorías del formulario público — mismas que ya se muestran en
// #sec-servicios de index.hbs, más "Otro" para lo que no encaje.
const SERVICIOS_COTIZACION = ['Renta de equipos', 'Internet', 'Impresiones', 'Tienda en sucursal', 'Otro'];

const CotizacionSchema = new mongoose.Schema({
  nombre:      { type: String, required: true, trim: true, maxlength: 120 },
  // Correo o teléfono en un solo campo de texto libre — el visitante
  // decide cómo prefiere que lo contacten.
  contacto:    { type: String, required: true, trim: true, maxlength: 120 },
  servicio:    { type: String, required: true, enum: SERVICIOS_COTIZACION },
  // Sucursal de preferencia es opcional — null si "cualquiera".
  sucursal:    { type: String, default: null, enum: [...SUCURSALES, null] },
  mensaje:     { type: String, default: '', trim: true, maxlength: 1000 },
  estado:      { type: String, default: 'pendiente', enum: ['pendiente', 'atendida'] },
  atendidaPor: { type: String, default: null },
}, { timestamps: true });

export default mongoose.model('Cotizacion', CotizacionSchema);
export { SERVICIOS_COTIZACION };
