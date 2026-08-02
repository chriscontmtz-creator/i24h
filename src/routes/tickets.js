import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import Ticket from '../models/Ticket.js';

const router = Router();

// El sync guarda sucursales sin acentos ni espacios (SimonBolivar).
// El panel usa nombres completos (Simón Bolívar). Aceptamos ambas variantes.
const VARIANTES = {
  'Simón Bolívar': ['SimonBolivar', 'Simón Bolívar', 'Simon Bolivar'],
  'Insurgentes':   ['Insurgentes'],
  'Antígona':      ['Antigona', 'Antígona'],
  'Lincoln Oxxo':  ['LincolnOxxo', 'Lincoln Oxxo'],
  'Lincoln 2':     ['Lincoln2', 'Lincoln 2'],
  'Ruiz Cortines': ['RuizCortines', 'Ruiz Cortines'],
  'Rodas':         ['Rodas'],
  'Cuauhtémoc':    ['Cuauhtemoc', 'Cuauhtémoc'],
  'Ordóñez':       ['Ordonez', 'Ordóñez'],
};

function filtroSucursal(suc) {
  if (!suc || suc === 'todas') return {};
  return { sucursal: { $in: VARIANTES[suc] || [suc] } };
}

// Rango completo del día en hora México (UTC-6)
// 00:00 MX = 06:00 UTC / 23:59 MX = 05:59 UTC del día siguiente
function rangoDiaMX(fechaStr) {
  let y, m, d;
  if (fechaStr) {
    [y, m, d] = fechaStr.split('-').map(Number);
  } else {
    const hoy = new Date();
    // Ajusta a hora México para obtener la fecha local correcta
    const mx = new Date(hoy.getTime() - 6 * 60 * 60 * 1000);
    y = mx.getUTCFullYear(); m = mx.getUTCMonth() + 1; d = mx.getUTCDate();
  }
  return {
    $gte: new Date(Date.UTC(y, m - 1, d,     6, 0, 0, 0)),
    $lte: new Date(Date.UTC(y, m - 1, d + 1, 5, 59, 59, 999)),
  };
}

// GET /api/tickets/dia?sucursal=Simón Bolívar&fecha=2026-07-13
// Devuelve todos los tickets no anulados del día con sus líneas
router.get('/tickets/dia', requireAuth, async (req, res) => {
  try {
    const { sucursal, fecha } = req.query;
    const match = {
      ...filtroSucursal(sucursal),
      fecha: rangoDiaMX(fecha),
      anulado: false,
    };

    const tickets = await Ticket
      .find(match)
      .sort({ fecha: 1, nticket: 1 })
      .lean();

    const total      = tickets.reduce((s, t) => s + (t.importeTotal || 0), 0);
    const porLinea   = {};

    tickets.forEach(t => {
      (t.lineas || []).forEach(l => {
        // Tipos 1,2,5,6 = ventas reales. Tipo 4 = interno, 16 = ajuste.
        if (![1, 2, 5, 6].includes(l.tipo)) return;
        const key = (l.detalle || 'Sin detalle').trim();
        if (!porLinea[key]) porLinea[key] = { detalle: key, tipo: l.tipo, unidades: 0, importe: 0 };
        porLinea[key].unidades += (l.cantidad || 1);
        porLinea[key].importe  += (l.importe  || 0);
      });
    });

    const resumenProductos = Object.values(porLinea)
      .sort((a, b) => b.importe - a.importe);

    res.json({ ok: true, total, numTickets: tickets.length, tickets, resumenProductos });
  } catch (err) {
    console.error('[tickets] dia:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
