import mongoose from 'mongoose';

const PromocionSchema = new mongoose.Schema({
  titulo:      { type: String, required: true, trim: true },
  descripcion: { type: String, required: true, trim: true },
  imagenUrl:   { type: String, trim: true, default: '' },
  beneficio:   { type: String, trim: true, default: '' },
  fechaInicio: { type: Date, required: true },
  fechaFin:    { type: Date, required: true },
  activa:      { type: Boolean, default: true },
  creadoPor:   { type: String, default: null },
}, { timestamps: true });

export default mongoose.model('Promocion', PromocionSchema);
