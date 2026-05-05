document.addEventListener("DOMContentLoaded", async function() {
    const config = await cargarDatos('data/configuracion.json');
    const planificacion = await cargarDatos('data/planificacion.json');

    const divInfo = document.getElementById('estado');
    if (divInfo) {
        const resultado = evaluarCobertura(planificacion["2026-05-12"], config);

        let html = '<h2>Estado del día 12/05/2026</h2>';
        resultado.forEach(r => {
            html += `<div class="card ${r.ok ? '' : 'alert-danger'}">`;
            html += `<strong>Turno ${r.turno}:</strong> ${r.asignados} personas (Mínimo: ${r.minimo})`;
            html += `</div>`;
        });
        divInfo.innerHTML = html;
    }
});
