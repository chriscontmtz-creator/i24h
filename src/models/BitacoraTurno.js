import mongoose from 'mongoose';

const productoSchema = new mongoose.Schema({
  categoria:     { type: String },
  nombre:        { type: String },
  stockInicial:  { type: Number, default: 0 },
  esperado:      { type: Number, default: 0 },
  conteo:        { type: Number, default: 0 },
  diferencia:    { type: Number, default: 0 },
  justificacion: { type: String, default: '' },
}, { _id: false });

const bitacoraTurnoSchema = new mongoose.Schema({
  sucursal:   { type: String, required: true },
  turno:      { type: String, required: true },
  fecha:      { type: Date,   required: true },
  responsable:{ type: String, default: '' },
  fechaCierre:{ type: Date,   default: Date.now },
  resumen: {
    ok:        { type: Number, default: 0 },
    falta:     { type: Number, default: 0 },
    sobra:     { type: Number, default: 0 },
    sinContar: { type: Number, default: 0 },
  },
  productos: [productoSchema],
  estado:     { type: String, enum: ['pendiente', 'revisado'], default: 'pendiente' },
}, { timestamps: true });

// Índice para búsqueda rápida por sucursal + fecha
bitacoraTurnoSchema.index({ sucursal: 1, fecha: -1 });

export default mongoose.model('BitacoraTurno', bitacoraTurnoSchema);
