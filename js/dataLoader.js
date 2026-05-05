async function cargarDatos(ruta) {
    const response = await fetch(`${ruta}?t=${Date.now()}`);
    return await response.json();
}
