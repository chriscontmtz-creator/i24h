import mongoose from 'mongoose';

// Registro de un descuento aplicado a un ticket real (sincronizado desde
// CyberPlanet, ver Ticket.js) porque la venta no fue real — típicamente un
// error de impresión (tóner mal configurado, etc.). No se modifica el
// Ticket original (es de solo lectura, viene del sync); esto vive aparte
// y se resta al calcular totales.
const AjusteTicketSchema = new mongoose.Schema({
  nticket: {
    type:     Number,
    required: true,
  },
  sucursal: {
    type:     String,
    required: true,
  },
  montoDescontado: {
    type:     Number,
    required: true,
    min:      0,
  },
  motivo: {
    type:     String,
    required: true,
    trim:     true,
    maxlength: 300,
  },
  registradoPor: {
    type:    String,
    default: 'Sistema',
  },
  fecha: {
    type:    Date,
    default: Date.now,
  },
}, { timestamps: true });

AjusteTicketSchema.index({ sucursal: 1, nticket: 1 });
AjusteTicketSchema.index({ sucursal: 1, fecha: -1 });

export default mongoose.model('AjusteTicket', AjusteTicketSchema);
