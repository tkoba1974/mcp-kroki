# MCP Kroki Server

An MCP (Model Context Protocol) server for converting Mermaid diagrams to SVG images using Kroki.io.

## Features

- Generate URLs for diagrams using Kroki.io
- Download diagrams as SVG, PNG, PDF, or JPEG files
- Support for multiple diagram formats:
  - Mermaid
  - PlantUML
  - Graphviz
  - And many more (see Kroki.io documentation)

## Installation

```bash
npm install
npm run build
```

## Usage

The server provides two main tools:

### 1. Generate Diagram URL

Generates a URL for a diagram using Kroki.io.

Parameters:
- `type`: The diagram type (e.g., "mermaid", "plantuml")
- `content`: The diagram content in the specified format
- `outputFormat` (optional): The output format (svg, png, pdf, jpeg, base64)

### 2. Download Diagram

Downloads a diagram to a local file.

Parameters:
- `type`: The diagram type (e.g., "mermaid", "plantuml")
- `content`: The diagram content in the specified format
- `outputPath`: The path where the diagram should be saved
- `outputFormat` (optional): The output format (svg, png, pdf, jpeg)

## Example

```javascript
// Generate a URL for a Mermaid diagram
const result = await callTool('generate_diagram_url', {
  type: 'mermaid',
  content: 'graph TD; A-->B; B-->C; C-->D;',
  outputFormat: 'svg'
});

// Download a Mermaid diagram
const result = await callTool('download_diagram', {
  type: 'mermaid',
  content: 'graph TD; A-->B; B-->C; C-->D;',
  outputPath: '/path/to/diagram.svg'
});
```

## How It Works

The server uses the Kroki.io API to convert diagrams. The diagram content is compressed and encoded before being sent to Kroki.io.

## Usage with Claude

Add to your Claude configuration:
```
{
  "mcpServers": {
    "mcp-kroki": {
      "command": "node",
      "args": ["Your Install Directory/mcp-kroki/build/index.js"]
    }
  }
}
```

## License

MIT
