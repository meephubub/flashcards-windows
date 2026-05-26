# Flashcards Windows App

A Tauri app with acrylic window effect, similar to macOS Spotlight.

## Features
- Acrylic blur effect using window-vibrancy
- Animated window opening
- 40% screen size, centered
- Transparent, frameless window
- Always on top

## Development

### Prerequisites
- Rust and Cargo
- Tauri CLI: `cargo install tauri-cli`
- Node.js and pnpm

### Running the app
```bash
pnpm install
cargo tauri dev
```

### Building for Windows
```bash
cargo tauri build
```

## Window Behavior
- Press `Escape` to close the window
- The window automatically focuses the search input on open
- Window is always on top and frameless for a clean look
