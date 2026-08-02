import { Router } from 'express';
import Revision          from '../models/Revision.js';
import ContadorImpresora from '../models/ContadorImpresora.js';
import ConteoFisico      from '../models/ConteoFisico.js';
import CorteCaja         from '../models/CorteCaja.js';
import Producto          from '../models/Producto.js';
import BitacoraTurno     from '../models/BitacoraTurno.js';
import Ticket            from '../models/Ticket.js';
import { requireEmpleado, requireAuth, sesionActual } from '../middlewares/auth.js';

function turnoCorto(t) {
  const m = (t || '').match(/Turno\s*(\d)/i);
  return m ? 'T' + m[1] : '?';
}

function turnoDesdeHora(hora) {
  const h = parseInt((hora || '00:00').split(':')[0]);
  if (h >= 7  && h < 15) return 'Turno1';
  if (h >= 15 && h < 23) return 'Turno2';
  return 'Turno3';
}

function turnoDesdeOperador(op) {
  const m = (op || '').match(/turno\s*(\d)/i);
  return m ? 'Turno' + m[1] : null;
}

// tipo=6 → impresiones de impresora (detalle = nombre de impresora)
// tipo=5 → productos físicos (copias, scanner, papelería, snacks…)
// tipo=1/2 → servicios de tiempo / internet / prepago
function categorizaLinea(detalle, tipo) {
  const d = (detalle || '').toLowerCase().trim();

  if (tipo === 6) {
    // detalle: "byn22", "BN1 (DOBLE CARTA)", "Color1 (COLOR)", "Color1 (TABLOIDES…)"
    return d.includes('color') ? 'impre_color' : 'impre_byn';
  }

  if (tipo === 5) {
    if (d.includes('scanner') || d.includes('escaner') || d.includes('escáner')) return 'scanner';
    if (d.includes('ine') && (d.includes('copi') || d.includes('copia'))) return 'copia_ine';
    // Cualquier producto tipo=5 con "color" en detalle pasa por la fotocopiadora color
    if (d.includes('color')) return 'copia_color';
    if (d.includes('copi') || d.includes('copia')) return 'copia_byn';
  }

  return 'otro';
}

function agregaTickets(tickets) {
  const r = {
    totalImporte: 0, totalTickets: 0,
    copias_byn_cant: 0, copias_byn_imp: 0,
    copias_color_cant: 0, copias_color_imp: 0,
    copias_ine_cant: 0, copias_ine_imp: 0,
    impre_byn_cant: 0, impre_byn_imp: 0,
    impre_color_cant: 0, impre_color_imp: 0,
    scanner_cant: 0, scanner_imp: 0,
    uso_libre_imp: 0, otro_imp: 0,
  };
  for (const t of tickets) {
    r.totalImporte  += t.importeTotal || 0;
    r.totalTickets  += 1;
    for (const l of (t.lineas || [])) {
      const cat = categorizaLinea(l.detalle, l.tipo);
      const qty = l.cantidad || 0;
      const imp = l.importe  || 0;
      if      (cat === 'copia_byn')   { r.copias_byn_cant   += qty; r.copias_byn_imp   += imp; }
      else if (cat === 'copia_color') { r.copias_color_cant += qty; r.copias_color_imp += imp; }
      else if (cat === 'copia_ine')   { r.copias_ine_cant   += qty; r.copias_ine_imp   += imp; }
      else if (cat === 'impre_byn')   { r.impre_byn_cant    += qty; r.impre_byn_imp    += imp; }
      else if (cat === 'impre_color') { r.impre_color_cant  += qty; r.impre_color_imp  += imp; }
      else if (cat === 'scanner')     { r.scanner_cant      += qty; r.scanner_imp      += imp; }
      else                            { r.otro_imp          += imp; }
    }
  }
  return r;
}

function deltaImp(campo, doc) {
  return doc && doc[campo] && doc[campo].delta != null ? doc[campo].delta : 0;
}

const router = Router();

const SUCURSALES = [
  'Simón Bolívar', 'Insurgentes', 'Antígona', 'Lincoln Oxxo',
  'Lincoln 2', 'Ruiz Cortines', 'Rodas', 'Cuauhtémoc', 'Ordóñez',
];

const SUCURSAL_DB = {
  'Simón Bolívar': 'SimonBolivar',
  'Insurgentes':   'Insurgentes',
  'Antígona':      'Antigona',
  'Lincoln Oxxo':  'LincolnOxxo',
  'Lincoln 2':     'LincolnDos',
  'Ruiz Cortines': 'RuizCortines',
  'Rodas':         'Rodas',
  'Cuauhtémoc':    'Cuauhtemoc',
  'Ordóñez':       'Ordonez',
};

// ── GET /revisiones ─────────────────────────────────────────────
router.get('/', sesionActual, requireEmpleado, async (req, res) => {
  try {
    const { sucursal = 'todas', turno = 'todos', estado = 'todos', pagina = 0, tab = 'contadores',
            periodo = 'mes_actual', desde = '', hasta = '', dia = 'todos' } = req.query;
    const limite = 20;
    const skip   = Number(pagina) * limite;

    const hoy = new Date();
    let fi, ff;
    let diasSemana = [];
    if (periodo === 'hoy') {
      fi = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
      ff = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 23, 59, 59));
    } else if (periodo === 'semana') {
      const dow = hoy.getUTCDay();
      const lunes = new Date(hoy); lunes.setUTCDate(hoy.getUTCDate() - (dow === 0 ? 6 : dow - 1));
      lunes.setUTCHours(0, 0, 0, 0);
      fi = new Date(Date.UTC(lunes.getUTCFullYear(), lunes.getUTCMonth(), lunes.getUTCDate()));
      ff = new Date(fi.getTime() + 6 * 24 * 3600 * 1000 + 23 * 3600 * 1000 + 59 * 60 * 1000 + 59000);

      const NOMBRES_DIA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
      diasSemana = NOMBRES_DIA.map((nombre, i) => {
        const d = new Date(fi);
        d.setUTCDate(fi.getUTCDate() + i);
        const fechaStr = d.toISOString().split('T')[0];
        return { nombre, fecha: fechaStr, activo: dia === fechaStr };
      });

      if (dia !== 'todos') {
        fi = new Date(dia + 'T00:00:00Z');
        ff = new Date(dia + 'T23:59:59Z');
      }
    } else if (periodo === 'mes_anterior') {
      fi = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
      ff = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 0, 23, 59, 59));
    } else if (periodo === 'personalizado' && desde && hasta) {
      fi = new Date(desde + 'T00:00:00Z');
      ff = new Date(hasta + 'T23:59:59Z');
    } else {
      // mes_actual (default)
      fi = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
      ff = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0, 23, 59, 59));
    }

    const filtro = { fecha: { $gte: fi, $lte: ff } };
    if (sucursal !== 'todas') filtro.sucursal = sucursal;
    if (turno    !== 'todos') filtro.turno    = turno;
    if (estado   !== 'todos') filtro.estado   = estado;

    const dbKeySuc = sucursal !== 'todas' ? (SUCURSAL_DB[sucursal] || sucursal) : null;

    const filtroCont = { completo: true, fecha: { $gte: fi, $lte: ff } };
    if (sucursal !== 'todas') filtroCont.sucursal = dbKeySuc;
    if (turno    !== 'todos') filtroCont.turno    = turno;

    const filtroCaja = { cerrada: true, fecha: { $gte: fi, $lte: ff } };
    if (sucursal !== 'todas') filtroCaja.sucursal = dbKeySuc;

    const filtroBit = { fecha: { $gte: fi, $lte: ff } };
    if (sucursal !== 'todas') filtroBit.sucursal = sucursal;
    if (turno    !== 'todos') {
      const n = turno.replace('Turno', '').trim();
      filtroBit.turno = new RegExp('Turno\\s*' + n, 'i');
    }

    const [revisiones, total, conteosFisicosRaw, contadoresRaw, bitacorasRaw, cortesCajaRaw] = await Promise.all([
      Revision.find(filtro).sort({ fecha: -1 }).skip(skip).limit(limite).lean(),
      Revision.countDocuments(filtro),
      ConteoFisico.find(
        sucursal !== 'todas' ? { sucursal } : {}
      ).sort({ fecha: -1 }).limit(10).lean(),
      ContadorImpresora.find(filtroCont).sort({ fecha: -1 }).limit(120).lean(),
      BitacoraTurno.find(filtroBit).sort({ fecha: -1 }).limit(30).lean(),
      CorteCaja.find(filtroCaja).sort({ fecha: -1 }).limit(30).lean(),
    ]);

    // Tickets y contadores por ncaja para RESUMEN DE CAJA
    const ncajasResumen = cortesCajaRaw.map(c => c.ncaja);
    const [ticketsResumen, contadoresResumen] = ncajasResumen.length
      ? await Promise.all([
          Ticket.find({
            sucursal: dbKeySuc || { $exists: true },
            ncaja: { $in: ncajasResumen },
            anulado: false,
          }).select('ncaja importeTotal lineas').lean(),
          ContadorImpresora.find({
            sucursal: dbKeySuc || { $exists: true },
            ncaja: { $in: ncajasResumen },
            completo: true,
          }).lean(),
        ])
      : [[], []];

    const conteosFisicos = conteosFisicosRaw.map(c => ({
      ...c,
      idStr:    c._id.toString(),
      fechaFmt: c.fecha
        ? new Date(c.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—',
      esCompletado: c.estado === 'completado',
      esEnProceso:  c.estado === 'en_proceso',
      esRevisado:   c.estado === 'revisado',
    }));

    // Añadir flags para la vista (HBS no tiene helpers eq/gt)
    const revisionesVista = revisiones.map(r => ({
      ...r,
      esPendiente:  r.estado === 'pendiente',
      esAprobada:   r.estado === 'aprobada',
      esCobrable:   r.estado === 'diferencia_cobrable',
      esSeguimiento:r.estado === 'seguimiento',
      fechaFmt:     new Date(r.fecha).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' }),
      resumenDif:   r.diferenciaTotal !== 0
        ? `Diferencia total: ${r.diferenciaTotal > 0 ? '+' : ''}${r.diferenciaTotal}`
        : 'Sin diferencias',
    }));

    const d = (campo, doc) => (doc[campo] && doc[campo].delta != null) ? doc[campo].delta : 0;

    const contadoresVista = contadoresRaw.map(c => ({
      idStr:          c._id.toString(),
      fechaFmt:       new Date(c.fecha).toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      }),
      ncaja:          c.ncaja,
      turno:          c.turno || '—',
      nombre:         c.nombre || c.serie,
      ip:             c.ip || '',
      copiarNegro:    d('copiarNegro',     c),
      copiarNegroG:   d('copiarNegroG',    c),
      copiarColor:    d('copiarColor',     c),
      copiarColorG:   d('copiarColorG',    c),
      imprimirNegro:  d('imprimirNegro',   c),
      imprimirNegroG: d('imprimirNegroG',  c),
      imprimirColor:  d('imprimirColor',   c),
      imprimirColorG: d('imprimirColorG',  c),
      escanerTotal:   d('escanerTotal',    c),
      escanerGrande:  d('escanerGrande',   c),
      dobleCarta:     d('papelDobleCarta', c),
      tabloide:       d('papelTabloide',   c),
    }));

    const bitacorasVista = bitacorasRaw.map(b => {
      const catMap = {};
      (b.productos || []).forEach(p => {
        const cat = p.categoria || 'Sin categoría';
        if (!catMap[cat]) catMap[cat] = [];
        const dif = p.diferencia ?? 0;
        catMap[cat].push({
          nombre:        p.nombre,
          esperado:      p.esperado ?? 0,
          conteo:        p.conteo   ?? 0,
          diferencia:    dif,
          justificacion: p.justificacion || '',
          esFaltante:    dif < 0,
          esSobrante:    dif > 0,
          difFmt:        (dif > 0 ? '+' : '') + dif,
        });
      });

      const categorias = Object.entries(catMap).map(([cat, items]) => ({
        nombre:    cat,
        conDif:    items.filter(i => i.diferencia !== 0),
        todos:     items,
        hayConDif: items.some(i => i.diferencia !== 0),
      }));

      const tc = turnoCorto(b.turno);
      return {
        idStr:       b._id.toString(),
        estado:      b.estado || 'pendiente',
        esRevisado:  (b.estado || 'pendiente') === 'revisado',
        sucursal:    b.sucursal,
        turno:       b.turno,
        turnoCorto:  tc,
        esT1:        tc === 'T1',
        esT2:        tc === 'T2',
        esT3:        tc === 'T3',
        responsable: b.responsable || '—',
        fechaFmt:    new Date(b.fecha).toLocaleDateString('es-MX', {
          weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
        }),
        horaFmt:     new Date(b.fechaCierre || b.createdAt).toLocaleTimeString('es-MX', {
          hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City',
        }),
        resumen:     b.resumen || {},
        categorias,
        tieneConDif: (b.productos || []).some(p => (p.diferencia ?? 0) !== 0),
      };
    });

    // ── RESUMEN DE CAJA ─────────────────────────────────────────
    // Agrupar tickets por ncaja
    const ticketsPorNcaja = {};
    for (const t of ticketsResumen) {
      if (!ticketsPorNcaja[t.ncaja]) ticketsPorNcaja[t.ncaja] = [];
      ticketsPorNcaja[t.ncaja].push(t);
    }
    // Agrupar contadores por ncaja (suma todos los campos de todas las impresoras)
    const contPorNcaja = {};
    for (const c of contadoresResumen) {
      if (!contPorNcaja[c.ncaja]) {
        contPorNcaja[c.ncaja] = {
          copBYN: 0, copColor: 0, impreBYN: 0, impreColor: 0,
          escanerTotal: 0, tabloide: 0, dobleCarta: 0,
        };
      }
      const cn = contPorNcaja[c.ncaja];
      cn.copBYN     += deltaImp('copiarNegro', c)   + deltaImp('copiarNegroG', c);
      cn.copColor   += deltaImp('copiarColor', c)   + deltaImp('copiarColorG', c);
      cn.impreBYN   += deltaImp('imprimirNegro', c) + deltaImp('imprimirNegroG', c);
      cn.impreColor += deltaImp('imprimirColor', c) + deltaImp('imprimirColorG', c);
      cn.escanerTotal += deltaImp('escanerTotal', c);
      cn.tabloide     += deltaImp('papelTabloide', c);
      cn.dobleCarta   += deltaImp('papelDobleCarta', c);
    }

    // Filtrar por turno si aplica
    const resumenCajaVista = cortesCajaRaw
      .filter(c => {
        if (turno === 'todos') return true;
        const t = turnoDesdeOperador(c.operador1) || turnoDesdeOperador(c.operador2) || turnoDesdeHora(c.horaApertura);
        return t === turno;
      })
      .map(c => {
        const t    = agregaTickets(ticketsPorNcaja[c.ncaja] || []);
        const cnt  = contPorNcaja[c.ncaja] || {};
        const tc   = turnoDesdeOperador(c.operador1) || turnoDesdeOperador(c.operador2) || turnoDesdeHora(c.horaApertura);
        const merma = c.merma || 0;

        const cobTodasCopias  = t.copias_byn_cant + t.copias_color_cant + t.copias_ine_cant;
        const cobTodasImpre   = t.impre_byn_cant  + t.impre_color_cant;
        const totalCobradas   = cobTodasCopias + cobTodasImpre;
        const cntTodasCopias  = (cnt.copBYN   || 0) + (cnt.copColor   || 0);
        const cntTodasImpre   = (cnt.impreBYN || 0) + (cnt.impreColor || 0);
        const totalContador   = cntTodasCopias + cntTodasImpre;
        const diferencia      = (totalCobradas + merma) - totalContador;

        const difScanner      = t.scanner_cant - (cnt.escanerTotal || 0);

        const difSign = diferencia > 0 ? '+' : '';
        const difScanSign = difScanner > 0 ? '+' : '';

        return {
          idStr:       c._id.toString(),
          ncaja:       c.ncaja,
          sucursal:    c.sucursal,
          turno:       tc,
          turnoCorto:  turnoCorto(tc),
          esT1:        tc === 'Turno1',
          esT2:        tc === 'Turno2',
          esT3:        tc === 'Turno3',
          operador:    c.operador1 || c.operador2 || '—',
          horaApertura: c.horaApertura || '—',
          horaCierre:   c.horaCierre   || '—',
          fechaFmt:     new Date(c.fecha).toLocaleDateString('es-MX', {
            weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
          }),
          // Ventas
          totalImporte:   t.totalImporte,
          totalImporteFmt: '$' + (t.totalImporte || 0).toLocaleString('es-MX'),
          totalTickets:   t.totalTickets,
          usoLibreImp:    t.uso_libre_imp,
          otroImp:        t.otro_imp,
          // Copias cobradas
          copBYNcob:   t.copias_byn_cant,
          copColorCob: t.copias_color_cant,
          copINEcob:   t.copias_ine_cant,
          // Impresiones cobradas
          impreBYNcob:   t.impre_byn_cant,
          impreColorCob: t.impre_color_cant,
          impreBYNimp:   t.impre_byn_imp,
          impreColorImp: t.impre_color_imp,
          // Scanner cobrado
          scannerCob: t.scanner_cant,
          scannerImp: t.scanner_imp,
          // Contadores SNMP
          copBYNcnt:    cnt.copBYN    || 0,
          copColorCnt:  cnt.copColor  || 0,
          impreBYNcnt:  cnt.impreBYN  || 0,
          impreColorCnt:cnt.impreColor|| 0,
          escanerCnt:   cnt.escanerTotal || 0,
          tabloideCnt:  cnt.tabloide   || 0,
          dobCartaCnt:  cnt.dobleCarta || 0,
          // Totales cruce
          totalCobradas,
          totalContador,
          merma,
          diferencia,
          difFmt:      difSign + diferencia,
          difOk:       diferencia >= 0,
          difMal:      diferencia < -5,
          difWarn:     diferencia < 0 && diferencia >= -5,
          // Scanner cruce
          difScanner,
          difScannerFmt: difScanSign + difScanner,
          difScannerOk:  difScanner >= 0,
          difScannerMal: difScanner < -2,
          // Estado sin contador
          sinContador: !contPorNcaja[c.ncaja],
        };
      });

    res.render('revisiones/index', {
      titulo:          'Revisiones',
      estiloExtra:     'css/revisiones.css',
      scriptPrincipal: 'js/revisiones.js',
      usuario:         req.session.usuario,
      sucursalActiva:  sucursal,
      turnoActivo:     turno,
      estadoActivo:    estado,
      sucursales:      SUCURSALES,
      revisiones:      revisionesVista,
      hayRevisiones:   revisionesVista.length > 0,
      total,
      pagina:          Number(pagina),
      limite,
      hayMas:          skip + limite < total,
      conteosFisicos,
      hayConteos:      conteosFisicos.length > 0,
      contadores:      contadoresVista,
      hayContadores:   contadoresVista.length > 0,
      bitacoras:         bitacorasVista,
      hayBitacoras:      bitacorasVista.length > 0,
      resumenCaja:       resumenCajaVista,
      hayResumenCaja:    resumenCajaVista.length > 0,
      tabActivo:         tab,
      periodoActivo:     periodo,
      desdeActivo:       desde,
      hastaActivo:       hasta,
      diasSemana,
      diaFiltro:         dia,
      diaActivo:         dia !== 'todos',
    });
  } catch (err) {
    console.error('Error en /revisiones:', err);
    res.status(500).send('Error al cargar revisiones');
  }
});

// ── GET /revisiones/api/conteo/productos ────────────────────────
router.get('/api/conteo/productos', requireAuth, async (req, res) => {
  try {
    const { sucursal } = req.query;
    if (!sucursal || sucursal === 'todas')
      return res.status(400).json({ error: 'Selecciona una sucursal' });
    const dbKey   = SUCURSAL_DB[sucursal] || sucursal;
    const productos = await Producto.find(
      { sucursal: dbKey, nombre: { $not: /^Nuevo Producto/ } }
    ).sort({ nombre: 1 }).lean();
    res.json({ productos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar productos' });
  }
});

// ── POST /revisiones/api/conteo ─────────────────────────────────
router.post('/api/conteo', requireAuth, async (req, res) => {
  try {
    const { sucursal, responsable, lineas } = req.body;
    if (!sucursal || !responsable || !Array.isArray(lineas) || !lineas.length)
      return res.status(400).json({ error: 'Faltan campos requeridos' });

    const procesadas = lineas.map(l => ({
      codigo:     Number(l.codigo),
      nombre:     l.nombre,
      fisico:     Number(l.fisico),
      esperado:   Number(l.esperado),
      diferencia: Number(l.fisico) - Number(l.esperado),
    }));

    const conDif   = procesadas.filter(l => l.diferencia !== 0).length;
    const valorDif = procesadas.reduce((s, l) => s + Math.abs(l.diferencia), 0);
    const actor    = req.session.usuario?.nombre || responsable;

    const conteo = await ConteoFisico.create({
      sucursal,
      responsable,
      fecha:           new Date(),
      cubreDesde:      new Date(),
      cubreHasta:      new Date(),
      lineas:          procesadas,
      totalProductos:  procesadas.length,
      productosConDif: conDif,
      valorDiferencia: valorDif,
      estado:          'completado',
      historial: [{
        evento:  'creado',
        actor,
        detalle: `Conteo de ${procesadas.length} productos · ${conDif} con diferencia`,
      }],
    });

    res.json({ ok: true, id: conteo._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar conteo' });
  }
});

// ── GET /revisiones/api/conteo/:id ──────────────────────────────
router.get('/api/conteo/:id', requireAuth, async (req, res) => {
  try {
    const conteo = await ConteoFisico.findById(req.params.id).lean();
    if (!conteo) return res.status(404).json({ error: 'No encontrado' });
    res.json({ conteo });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener conteo' });
  }
});

// ── GET /revisiones/:ncaja — Detalle de una revisión (JSON) ─────
router.get('/api/:ncaja', requireAuth, async (req, res) => {
  try {
    const { sucursal } = req.query;
    const filtro = { ncaja: Number(req.params.ncaja) };
    if (sucursal) filtro.sucursal = sucursal;

    const [revision, contadores] = await Promise.all([
      Revision.findOne(filtro).lean(),
      ContadorImpresora.find({ ncaja: filtro.ncaja, ...(sucursal ? { sucursal } : {}) }).lean(),
    ]);

    if (!revision) return res.status(404).json({ error: 'Revisión no encontrada' });
    res.json({ revision, contadores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener revisión' });
  }
});

// ── POST /revisiones/api/:ncaja/aprobar ─────────────────────────
router.post('/api/:ncaja/aprobar', requireAuth, async (req, res) => {
  try {
    const { sucursal } = req.body;
    const revision = await Revision.findOne({ ncaja: Number(req.params.ncaja), sucursal });
    if (!revision) return res.status(404).json({ error: 'Revisión no encontrada' });

    const sinCausa = revision.comparaciones.filter(c => c.cobrable && !c.causa);
    if (sinCausa.length > 0)
      return res.status(400).json({ error: `Hay ${sinCausa.length} diferencia(s) cobrable(s) sin causa asignada` });

    revision.estado = 'aprobada';
    revision.historial.push({
      evento:  'aprobada',
      actor:   req.session.usuario?.nombre || 'Sistema',
      detalle: `Revisión aprobada con ${revision.comparaciones.filter(c => c.diferencia !== 0).length} diferencia(s)`,
    });
    await revision.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al aprobar' });
  }
});

// ── POST /revisiones/api/:ncaja/causa ───────────────────────────
router.post('/api/:ncaja/causa', requireAuth, async (req, res) => {
  try {
    const { sucursal, concepto, causa } = req.body;
    const revision = await Revision.findOne({ ncaja: Number(req.params.ncaja), sucursal });
    if (!revision) return res.status(404).json({ error: 'Revisión no encontrada' });

    const comp = revision.comparaciones.find(c => c.concepto === concepto);
    if (!comp) return res.status(400).json({ error: 'Concepto no encontrado' });

    const valorAnterior = comp.causa;
    comp.causa    = causa;
    comp.cobrable = false;

    revision.historial.push({
      evento:  'causa_asignada',
      actor:   req.session.usuario?.nombre || 'Sistema',
      detalle: `Causa asignada a ${comp.etiqueta}: "${causa}"`,
      valorAnterior,
      valorNuevo: causa,
    });

    revision.superaTolerancia = revision.comparaciones.some(c => c.cobrable);
    revision.estado = revision.superaTolerancia ? 'diferencia_cobrable' : 'pendiente';
    await revision.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al asignar causa' });
  }
});

// ── POST /revisiones/api/:ncaja/corregir ────────────────────────
router.post('/api/:ncaja/corregir', requireAuth, async (req, res) => {
  try {
    const { sucursal, concepto, campo, valorNuevo, motivo } = req.body;
    const revision = await Revision.findOne({ ncaja: Number(req.params.ncaja), sucursal });
    if (!revision) return res.status(404).json({ error: 'Revisión no encontrada' });

    const comp = revision.comparaciones.find(c => c.concepto === concepto);
    if (!comp) return res.status(400).json({ error: 'Concepto no encontrado' });

    const valorAnterior = { contador: comp.contador, cobrado: comp.cobrado };
    comp[campo === 'contador' ? 'contador' : 'cobrado'] = Number(valorNuevo);
    comp.diferencia = comp.contador - comp.cobrado;
    comp.cobrable   = comp.diferencia < revision.tolerancia && !comp.causa;

    revision.historial.push({
      evento:  'correccion',
      actor:   req.session.usuario?.nombre || 'Sistema',
      detalle: `Corrección en ${comp.etiqueta}: ${motivo}`,
      valorAnterior,
      valorNuevo: { [campo]: Number(valorNuevo) },
    });

    revision.diferenciaTotal  = revision.comparaciones.reduce((s, c) => s + c.diferencia, 0);
    revision.superaTolerancia = revision.comparaciones.some(c => c.cobrable);
    await revision.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al corregir' });
  }
});

// ── POST /revisiones/api/caja/:id/merma ─────────────────────────
router.post('/api/caja/:id/merma', requireAuth, async (req, res) => {
  try {
    const { merma, mermaNotas } = req.body;
    const val = Number(merma);
    if (isNaN(val) || val < 0)
      return res.status(400).json({ error: 'Merma inválida' });
    const caja = await CorteCaja.findByIdAndUpdate(
      req.params.id,
      { $set: { merma: val, mermaNotas: (mermaNotas || '').trim() } },
      { new: true }
    ).lean();
    if (!caja) return res.status(404).json({ error: 'Caja no encontrada' });
    res.json({ ok: true, merma: caja.merma, mermaNotas: caja.mermaNotas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar merma' });
  }
});

// ── POST /revisiones/api/bitacora/:id/estado ────────────────────
router.post('/api/bitacora/:id/estado', requireAuth, async (req, res) => {
  try {
    const { estado } = req.body;
    if (!['pendiente', 'revisado'].includes(estado))
      return res.status(400).json({ error: 'Estado inválido' });
    const bit = await BitacoraTurno.findByIdAndUpdate(
      req.params.id,
      { $set: { estado } },
      { new: true }
    ).lean();
    if (!bit) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true, estado: bit.estado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

export default router;
