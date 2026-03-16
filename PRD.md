PRD: Visor Markdown/TXT Minimalista

1. Research & Oportunidad (Opportunity Document)

    Problem: Leer archivos .md o .txt rápidamente en Windows es frustrante. El Bloc de notas no renderiza Markdown ni tiene syntax highlighting. Abrir VS Code, Obsidian o cualquier app basada en Electron toma demasiados segundos (cold start lento) y consume mucha RAM solo para una lectura rápida.

    Target Audience: Desarrolladores, escritores técnicos y usuarios avanzados que necesitan previsualizar documentación o logs al instante con un doble clic.

    Competition:

        Bloc de notas (Windows): Ultrarrápido, pero sin formato.

        VS Code / Obsidian: Excelente formato, pero lentos y pesados para esta tarea específica.

        MarkText / Typora: Estéticos, pero basados en Electron (pesados).

    Unique Angle (The Wedge): Velocidad extrema e integración nativa. Al usar Rust + Tauri v2, el visor abrirá instantáneamente como una app nativa, pesará muy poco y no tendrá distracciones.

    Monetization: Open-source (gratuito). Posibilidad de donaciones o integraciones futuras de pago si evoluciona.

    Build Estimate (MVP): 1 a 2 fines de semana de desarrollo.

    Verdict: Build.

2. Especificaciones Técnicas (Stack 2026)

    Backend / Core: Rust

    Framework de App: Tauri v2 (aprovechando las mejoras recientes en IPC - Inter-Process Communication y tamaño de binarios).

    WebView OS: WebView2 (Edge/Chromium nativo en Windows).

    Frontend: HTML/CSS/Vanilla JS (Para mantener el minimalismo absoluto y evitar el overhead de frameworks como React, aunque Svelte es una opción válida si crece).

    Procesamiento Markdown: pulldown-cmark (crate de Rust, extremadamente rápido).

    Syntax Highlighting: syntect (Rust) o Prism.js (Frontend). Recomendado syntect en el backend para enviar HTML ya coloreado y quitarle carga al WebView.

3. Requisitos Funcionales (El MVP)

    Integración con el SO:

        La aplicación debe poder registrarse como programa predeterminado para extensiones .md y .txt en Windows.

        Debe capturar la ruta del archivo que el usuario abrió mediante doble clic (vía argumentos CLI en Rust).

    Visualización de Contenido:

        Renderizado automático de Markdown a HTML.

        Renderizado de texto plano .txt respetando saltos de línea y monoespacio.

        Soporte para resaltado de sintaxis dentro de los bloques de código en Markdown.

    Interacción Minimalista:

        Selección y Copia: Texto seleccionable de forma nativa. Atajo Ctrl+C.

        Zoom: Aumentar/Disminuir tamaño de fuente usando Shift + Scroll (o Ctrl + Scroll que es el estándar de Windows).

    Personalización Básica:

        Selector de tema: Claro / Oscuro (o seguir el tema del sistema operativo por defecto).

4. Requisitos No Funcionales (Métricas de Éxito)

    Rendimiento: El tiempo de inicio (Cold Start) desde el doble clic hasta el renderizado del texto debe ser menor a 100ms.

    Huella en disco: El ejecutable final (.exe) debe pesar menos de 10MB.

    Consumo de RAM: Mantenerse por debajo de los 30MB en reposo.

    UI/UX: Ausencia de menús complejos, barras de herramientas intrusivas o pestañas en el MVP. La ventana es el contenido.
