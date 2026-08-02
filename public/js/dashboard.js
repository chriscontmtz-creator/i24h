// dashboard.js — lógica del cliente para el Dashboard i24h

// ── Dark mode ──────────────────────────────────────────────────
(function () {
  const btn = document.getElementById('dash-dark-btn');
  const ico = document.getElementById('dash-dark-ico');

  function aplicar(oscuro) {
    document.body.classList.toggle('dark', oscuro);
    document.documentElement.classList.toggle('dark', oscuro);
    localStorage.setItem('dark', oscuro ? '1' : '0');
    if (ico) ico.className = oscuro ? 'ti ti-sun' : 'ti ti-moon';
  }

  aplicar(localStorage.getItem('dark') === '1');

  if (btn) btn.addEventListener('click', () => {
    aplicar(!document.body.classList.contains('dark'));
  });
})();

// ── Gráfica de ventas diarias ──────────────────────────────────
(function () {
  const canvas = document.getElementById('chartVentas');
  if (!canvas || typeof Chart === 'undefined') return;

  const data = window.DASH_DATA || {};
  const items = data.ventaDiaria || [];

  if (items.length === 0) {
    canvas.parentElement.innerHTML = '<p style="padding:20px;color:var(--d-tex-muted);text-align:center">Sin datos de venta para el período seleccionado</p>';
    return;
  }

  const labels  = items.map(d => d.fecha.slice(5));  // MM-DD
  const valores = items.map(d => d.total);
  const MAX     = data.maxVenta || 1;
  const UMBRAL  = 15000;

  const isDark = document.body.classList.contains('dark') || document.documentElement.classList.contains('dark');
  const gridColor  = isDark ? '#333' : '#E0DFDB';
  const textColor  = isDark ? '#707070' : '#9A9A9A';
  const barDefault = isDark ? '#444' : '#D3D1C7';

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: valores,
        backgroundColor: valores.map(v => v >= UMBRAL ? '#D72638' : barDefault),
        borderRadius: 4,
        barPercentage: 0.8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => ctx[0].label,
            label: ctx => '$' + ctx.raw.toLocaleString('es-MX') + ' MXN',
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: textColor, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 15 },
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { size: 11 },
            callback: v => '$' + Math.round(v / 1000) + 'k',
          },
          border: { display: false },
        },
      },
    },
  });
})();
