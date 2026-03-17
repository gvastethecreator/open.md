# OpenMD

Visor minimalista de archivos `Markdown` y `TXT` construido con `Tauri v2`, `Rust`, `Vite` y `JavaScript`.

## Qué hace

- abre archivos `.md`, `.markdown` y `.txt`
- soporta drag & drop y apertura múltiple en nuevas ventanas
- renderiza Mermaid
- aplica themes desde un catálogo grande
- recuerda el theme elegido
- permite abrir enlaces markdown relativos dentro del mismo flujo de lectura

## VS Code tasks y scripts útiles

- `bun run dev`: arranca Vite para desarrollo frontend.
- `bun run tauri dev`: abre la app Tauri en desarrollo.
- `bun run build`: genera el frontend de producción.
- `bun run tauri build`: empaqueta la app nativa.
- `bun run check:frontend`: valida la integración estática del frontend (HTML, CSS, JS y temas).
- `bun run check:rust`: compila el backend Rust sin empaquetar.
- `bun run test:rust`: ejecuta las pruebas unitarias de Rust.
- `bun run test:frontend`: ejecuta las pruebas de frontend con Vitest.
- `bun run fmt:rust`: verifica formato Rust.
- `bun run verify`: corre la validación completa recomendada antes de empaquetar.

## Flujo recomendado

1. `bun install`
2. `bun run tauri dev`
3. antes de empaquetar, `bun run verify`
4. release local: `bun run tauri build`

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
