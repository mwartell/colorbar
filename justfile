# Recipes for building and packaging the Colorbar VS Code extension

# Use bash for predictable pipes on macOS
set shell := ["bash", "-cu"]

# Default target builds a VSIX
default: package

# Install dependencies
deps:
    npm install

# Compile TypeScript to out/
build: deps
    npm run compile

# Create a VSIX in the repo root (runs build first)
package: build
    npx @vscode/vsce package

# Remove build artifacts and packaged VSIX files
clean:
    rm -rf out *.vsix

# Build and install the newest VSIX into VS Code
install: package
    code --install-extension "$(ls -t *.vsix | head -n1)"

# Publish to the Marketplace (requires publisher + PAT)
# Usage examples:
#   just publish                 # uses default 'patch'
#   just publish VERSION=minor
#   just publish VERSION=1.2.3
publish VERSION='patch':
    vsce publish {{VERSION}}
