# Contributing to Memvid

Thank you for your interest in contributing to Memvid! We welcome contributions from everyone.

## Getting Started

### Prerequisites

- **Rust 1.85.0+** — Install from [rustup.rs](https://rustup.rs)
- **Git** — For version control

For Node.js bindings development:
- **Node.js 20+** — Install from [nodejs.org](https://nodejs.org)
- **npm** — Included with Node.js

### Setup

1. **Fork the repository** on GitHub

2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/memvid.git
   cd memvid
   ```

3. **Build the project**:
   ```bash
   cargo build
   ```

4. **Run tests**:
   ```bash
   cargo test
   ```

## Development Workflow

### Creating a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### Making Changes

1. Write your code following the [code style guidelines](#code-style)
2. Add tests for new functionality
3. Ensure all tests pass: `cargo test`
4. Run clippy: `cargo clippy`
5. Format code: `cargo fmt`

### Committing

Write clear, concise commit messages:

```bash
git commit -m "feat: add support for XYZ"
git commit -m "fix: resolve issue with ABC"
git commit -m "docs: update README examples"
```

### Submitting a Pull Request

1. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open a Pull Request on GitHub

3. Fill out the PR template completely

4. Wait for review and address feedback

## Code Style

### Rust Guidelines

- Follow standard Rust idioms and conventions
- Use `rustfmt` for formatting (`cargo fmt`)
- Use `clippy` for linting (`cargo clippy`)
- Prefer explicit types for public APIs
- Use `thiserror` for error definitions

### Documentation

- Add doc comments (`///`) to all public functions, structs, and modules
- Include examples in doc comments where helpful
- Keep comments concise and up-to-date

### Testing

- Write unit tests for new functionality
- Place tests in the same file using `#[cfg(test)]` module
- Integration tests go in the `tests/` directory
- Aim for high coverage of edge cases

## Project Structure

This is a **Cargo workspace** containing the Rust core library and language bindings.

```
memvid/
├── Cargo.toml        # Workspace root + memvid-core package
├── src/              # Rust core library (memvid-core)
│   ├── lib.rs        # Public API
│   ├── memvid/       # Core implementation
│   ├── io/           # File I/O
│   └── types/        # Type definitions
├── tests/            # Rust integration tests
├── examples/         # Rust examples
├── native/           # Node.js bindings (memvid-node)
│   ├── Cargo.toml    # NAPI-RS bindings
│   ├── package.json  # npm package
│   ├── src/          # Rust bindings + TypeScript wrapper
│   └── __tests__/    # Vitest tests
└── .github/workflows/
    ├── ci.yml        # Rust core CI
    └── native-ci.yml # Node.js bindings CI
```

### Working with the Workspace

```bash
# Build everything
cargo build --workspace

# Build only core
cargo build -p memvid-core

# Build only Node.js bindings
cargo build -p memvid-node

# Test everything
cargo test --workspace
```

## Feature Flags

When adding new functionality, consider if it should be behind a feature flag:

```toml
[features]
my_feature = ["dep:some-dependency"]
```

This keeps the default build lean and fast.

## Node.js Bindings Development

The `native/` directory contains Node.js bindings using NAPI-RS.

### Setup

```bash
cd native
npm install
```

### Development Workflow

```bash
# Build native module (debug)
npm run build:native:debug

# Build TypeScript wrapper
npm run build:ts

# Run tests
npm test

# Full release build
npm run build:native
```

### Testing Against Local Core Changes

The `native/Cargo.toml` uses both `path` and `version` for the core dependency:

```toml
memvid-core = { version = "^2.0", path = "..", features = ["lex"] }
```

- During development: Uses local source (path)
- During publish: Verifies compatibility with published version

## Release Workflow

### Releasing memvid-core (Rust)

1. Update version in `Cargo.toml`:
   ```toml
   version = "2.0.132"
   ```

2. Commit and tag:
   ```bash
   git add Cargo.toml
   git commit -m "chore: release memvid-core v2.0.132"
   git tag v2.0.132
   git push origin main --tags
   ```

3. Publish to crates.io:
   ```bash
   cargo publish
   ```

### Releasing memvid-node (Node.js)

1. Ensure memvid-core is published first (if there are core changes)

2. Update version in `native/package.json`:
   ```json
   "version": "1.0.1"
   ```

3. Update version compatibility in `native/Cargo.toml` if needed:
   ```toml
   memvid-core = { version = "^2.0.132", path = "..", features = ["lex"] }
   ```

4. Commit and tag (use `native-v` prefix):
   ```bash
   git add native/
   git commit -m "chore: release memvid-node v1.0.1"
   git tag native-v1.0.1
   git push origin main --tags
   ```

5. The GitHub Action will build cross-platform binaries and publish to npm

### Coordinated Releases

When releasing both packages with breaking changes:

1. Publish memvid-core to crates.io first
2. Update `native/Cargo.toml` to require the new version
3. Test the Node.js bindings: `cd native && npm test`
4. Publish memvid-node to npm

## Reporting Issues

When reporting bugs, please include:

- Rust version (`rustc --version`)
- Operating system
- Memvid version
- Minimal code to reproduce
- Expected vs actual behavior

## Translations

Interested in translating Memvid's documentation? See [Contributing Translations](docs/i18n/CONTRIBUTING_TRANSLATIONS.md) for guidelines on translating the README and other documentation.

## Getting Help

- Open a [Discussion](https://github.com/memvid/memvid/discussions) for questions
- Check existing [Issues](https://github.com/memvid/memvid/issues) for similar problems
- Email: contact@memvid.com

## Recognition

Contributors are:
- Listed in release notes
- Part of the Memvid community

---

**Thank you for making Memvid better!**
