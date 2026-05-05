function evaluarCobertura(diaPlan, configuracion) {
    const resultados = [];
    configuracion.turnos.forEach(turno => {
        const datosTurno = diaPlan && diaPlan[turno.nombre] ? diaPlan[turno.nombre] : { asignados: [] };
        const numAsignados = datosTurno.asignados.length;

        resultados.push({
            turno: turno.nombre,
            asignados: numAsignados,
            minimo: turno.min_personal,
            ok: numAsignados >= turno.min_personal
        });
    });
    return resultados;
}
