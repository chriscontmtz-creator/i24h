import mongoose from 'mongoose';

const CorteCajaSchema = new mongoose.Schema({
  ncaja:        { type: Number, required: true },
  fecha:        { type: Date,   required: true },
  horaApertura: { type: String },
  operador1:    { type: String, trim: true },
  operador2:    { type: String, trim: true },
  ingreso:      { type: Number, default: 0 },
  fechaCierre:  { type: Date },
  horaCierre:   { type: String },
  cerrada:      { type: Boolean, default: false },
  sucursal:     { type: String, required: true },
  merma:        { type: Number, default: 0 },
  mermaNotas:   { type: String, default: '' },
}, { timestamps: true });

CorteCajaSchema.index({ sucursal: 1, fecha: -1 });
CorteCajaSchema.index({ sucursal: 1, ncaja: 1 }, { unique: true });

export default mongoose.model('CorteCaja', CorteCajaSchema);
