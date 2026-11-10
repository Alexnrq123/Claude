# Guías Rítmicas del coro

App para escribir guías rítmicas (charts de slashes) de las alabanzas, con biblioteca, setlists y PDF para imprimir.

- `src/motor.js`: lee el texto de la guía y dibuja la partitura en SVG.
- `src/app.html`: interfaz (biblioteca, editor, setlists, PDF).
- `fuentes/`: Petaluma, Petaluma Script, Bravura (SIL OFL) y Barlow Semi Condensed (OFL), recortadas.
- `ejemplos/tuyo-soy.json`: guía de ejemplo.

Construir: `python3 build.py` genera `index.html`.
