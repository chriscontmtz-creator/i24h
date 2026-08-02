import mongoose from 'mongoose';

const CategoriaSchema = new mongoose.Schema({
  codigo:   { type: Number, required: true },
  nombre:   { type: String, required: true, trim: true },
  sucursal: { type: String, required: true },
}, { timestamps: true });

CategoriaSchema.index({ sucursal: 1, codigo: 1 }, { unique: true });

export default mongoose.model('Categoria', CategoriaSchema);
