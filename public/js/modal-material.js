/* ============================================================
   TICKETS I24H — cliente vanilla JS
   (el resumen de "venta sin material" vive ahora solo en el Dashboard)
   ============================================================ */

'use strict';

function vsmFmtMoney(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function vsmSetEstado(elId, texto, tipo) {
  var el = document.getElementById(elId);
  if (!el) return;
  if (!texto) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = texto;
  el.className = 'vsm-estado vsm-estado--' + (tipo || 'loading');
}

// ── Abrir / cerrar modal ────────────────────────────────────

function abrirModalMaterial() {
  var overlay = document.getElementById('vsm-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
}
window.abrirModalMaterial = abrirModalMaterial;

function cerrarModalMaterial() {
  var overlay = document.getElementById('vsm-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ── Buscar ticket y aplicar descuento manual ──────────────────

var vsmTicketActual = null;

async function vsmBuscarTicket() {
  var sucursal = document.getElementById('vsm-tk-sucursal').value;
  var nticket  = document.getElementById('vsm-tk-nticket').value;
  var resultado = document.getElementById('vsm-tk-resultado');

  if (!sucursal || !nticket) {
    vsmSetEstado('vsm-tk-estado', 'Selecciona sucursal e indicá el número de ticket', 'error');
    return;
  }
  vsmSetEstado('vsm-tk-estado', 'Buscando…', 'loading');
  resultado.classList.add('hidden');

  try {
    var resp = await fetch('/api/material/buscar-ticket?sucursal=' + encodeURIComponent(sucursal) + '&nticket=' + encodeURIComponent(nticket));
    var data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || 'Ticket no encontrado');

    vsmSetEstado('vsm-tk-estado', null);
    vsmTicketActual = data.ticket;

    document.getElementById('vsm-tk-info-num').textContent = data.ticket.nticket;
    document.getElementById('vsm-tk-info-importe').textContent = vsmFmtMoney(data.ticket.importeTotal);
    document.getElementById('vsm-tk-info-fecha').textContent = new Date(data.ticket.fecha).toLocaleString('es-MX');

    document.getElementById('vsm-tk-monto').value = '';
    document.getElementById('vsm-tk-motivo').value = '';

    vsmRenderPrevios(data.ajustesPrevios);
    resultado.classList.remove('hidden');
  } catch (err) {
    vsmSetEstado('vsm-tk-estado', err.message || 'Ticket no encontrado', 'error');
  }
}

function vsmRenderPrevios(ajustes) {
  var el = document.getElementById('vsm-tk-previos');
  if (!ajustes || !ajustes.length) {
    el.innerHTML = '<em>Sin descuentos previos aplicados a este ticket.</em>';
    return;
  }
  el.innerHTML = '<div style="margin-bottom:6px;color:#999">Descuentos previos:</div>' +
    ajustes.map(function (a) {
      return '<div class="vsm-tk-previo-item">' +
        vsmFmtMoney(a.montoDescontado) + ' — ' + a.motivo +
        ' <span style="color:#777">(' + (a.registradoPor || 'Sistema') + ', ' + new Date(a.fecha).toLocaleDateString('es-MX') + ')</span>' +
        '</div>';
    }).join('');
}

async function vsmAplicarAjuste() {
  if (!vsmTicketActual) return;
  var sucursal = document.getElementById('vsm-tk-sucursal').value;
  var monto    = document.getElementById('vsm-tk-monto').value;
  var motivo   = document.getElementById('vsm-tk-motivo').value;
  var btn      = document.getElementById('vsm-tk-btn-aplicar');

  btn.disabled = true;
  vsmSetEstado('vsm-tk-estado', 'Aplicando descuento…', 'loading');

  try {
    var resp = await fetch('/api/material/ajuste-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nticket: vsmTicketActual.nticket,
        sucursal: sucursal,
        montoDescontado: monto,
        motivo: motivo,
      }),
    });
    var data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || 'Error al aplicar el descuento');

    vsmSetEstado('vsm-tk-estado', 'Descuento aplicado', 'ok');
    document.getElementById('vsm-tk-monto').value = '';
    document.getElementById('vsm-tk-motivo').value = '';
    await vsmBuscarTicket(); // refresca info + historial de previos
  } catch (err) {
    vsmSetEstado('vsm-tk-estado', err.message || 'Error al aplicar el descuento', 'error');
  } finally {
    btn.disabled = false;
  }
}
window.vsmAplicarAjuste = vsmAplicarAjuste;

// ── Wiring ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  var close = document.getElementById('vsm-close');
  if (close) close.addEventListener('click', cerrarModalMaterial);

  var overlay = document.getElementById('vsm-overlay');
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) cerrarModalMaterial();
    });
  }

  var btnTkBuscar = document.getElementById('vsm-tk-btn-buscar');
  if (btnTkBuscar) btnTkBuscar.addEventListener('click', vsmBuscarTicket);
});
