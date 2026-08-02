import mongoose from 'mongoose';

const LecturaSchema = new mongoose.Schema({
  inicial: { type: Number, default: 0 },
  final:   { type: Number, default: 0 },
  delta:   { type: Number, default: 0 },
}, { _id: false });

const ContadorImpresoraSchema = new mongoose.Schema({
  serie:    { type: String, required: true, trim: true },
  nombre:   { type: String, trim: true },
  ip:       { type: String, trim: true },
  sucursal: { type: String, required: true },
  ncaja:    { type: Number, required: true },
  turno:    { type: String, trim: true },
  fecha:    { type: Date,   required: true },

  copiarNegro:   { type: LecturaSchema, default: () => ({}) },
  copiarNegroG:  { type: LecturaSchema, default: () => ({}) },
  copiarColor:   { type: LecturaSchema, default: () => ({}) },
  copiarColorG:  { type: LecturaSchema, default: () => ({}) },

  imprimirNegro:   { type: LecturaSchema, default: () => ({}) },
  imprimirNegroG:  { type: LecturaSchema, default: () => ({}) },
  imprimirColor:   { type: LecturaSchema, default: () => ({}) },
  imprimirColorG:  { type: LecturaSchema, default: () => ({}) },

  escanerTotal:  { type: LecturaSchema, default: () => ({}) },
  escanerGrande: { type: LecturaSchema, default: () => ({}) },

  papelDobleCarta: { type: LecturaSchema, default: () => ({}) },
  papelTabloide:   { type: LecturaSchema, default: () => ({}) },

  lecturaInicialAt: { type: Date },
  lecturaFinalAt:   { type: Date },
  completo:         { type: Boolean, default: false },
}, { timestamps: true });

ContadorImpresoraSchema.index({ sucursal: 1, serie: 1, ncaja: 1 }, { unique: true });
ContadorImpresoraSchema.index({ sucursal: 1, fecha: -1 });

export default mongoose.model('ContadorImpresora', ContadorImpresoraSchema);
